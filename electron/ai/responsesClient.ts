import type { Message, Model, Settings, Source } from '../../shared/contracts.ts';
import type { Locale } from '../../shared/i18n.ts';
import { AiError, requestIdentifier, responseError, type AiStage } from './aiError.ts';
import { readModelCatalog } from './modelService.ts';
import { personality } from './personality.ts';
import { likelyNeedsSearch, readCitation, searchFields, searchNotUsed, searchUnavailable } from './searchService.ts';
import { interruption, readEvents } from './sse.ts';
import { readTokenUsage, type TokenUsage } from '../../shared/usage.ts';

export { AiError } from './aiError.ts';
export type { AiErrorCode } from './aiError.ts';

const api = 'https://api.openai.com/v1';
const historyCharacters = 24_000;
const historyTurns = 8;

type AccessToken = (forceRefresh?: boolean) => Promise<string>;
type ResponseInput = {
  model: string;
  messages: Message[];
  tone: Settings['tone'];
  length: Settings['length'];
  search: boolean;
  locale?: Locale;
  petName?: string;
  skipAutomaticSearch?: boolean;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onUsage?: (tokens: TokenUsage | undefined, model: string | undefined) => void;
};

type Answer = {
  text: string;
  sources: Source[];
  search: Message['search'];
  warning?: string;
};

function messageContext(messages: Message[]) {
  const users = messages.filter(message => message.role === 'user');
  const latest = users.at(-1);
  if (!latest?.text.trim()) throw new AiError('rejected');

  const input = [{ role: latest.role, content: latest.text }];
  let characters = latest.text.length;
  let assistant: Message | undefined;
  const latestIndex = messages.lastIndexOf(latest);
  for (let index = latestIndex - 1; index >= 0 && input.length < 1 + historyTurns * 2; index--) {
    const message = messages[index];
    if (message.role === 'assistant') {
      assistant = (!message.status || message.status === 'complete') && message.text.trim() ? message : undefined;
    } else if (assistant) {
      characters += message.text.length + assistant.text.length;
      if (characters > historyCharacters) break;
      input.unshift({ role: message.role, content: message.text }, { role: assistant.role, content: assistant.text });
      assistant = undefined;
    }
  }
  return input;
}

function completedOutput(value: unknown) {
  const response = asRecord(value);
  const text: string[] = [];
  const sources = new Map<string, Source>();
  let searched = false;

  for (const entry of Array.isArray(response.output) ? response.output : []) {
    const item = asRecord(entry);
    if (item.type === 'web_search_call' && item.status === 'completed') searched = true;
    if (item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) continue;
    for (const entry of item.content) {
      const content = asRecord(entry);
      if (content.type === 'refusal' && typeof content.refusal === 'string') text.push(content.refusal);
      if (content.type !== 'output_text') continue;
      if (typeof content.text === 'string') text.push(content.text);
      for (const annotation of Array.isArray(content.annotations) ? content.annotations : []) {
        const source = readCitation(annotation);
        if (source && !sources.has(source.url)) sources.set(source.url, source);
      }
    }
  }
  return { text: text.join('\n\n'), sources: [...sources.values()], searched };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export class AiService {
  private readonly getAccessToken: AccessToken;
  private readonly fetcher: typeof fetch;

  constructor(getAccessToken: AccessToken, options: { fetch?: typeof fetch } = {}) {
    this.getAccessToken = getAccessToken;
    this.fetcher = options.fetch ?? fetch;
  }

  async models(): Promise<Model[]> {
    const signal = AbortSignal.timeout(30_000);
    const response = await this.authorized('/models', { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw await this.httpError(response, signal, 'model-catalog');
    try {
      return await readModelCatalog(response);
    } catch (error) {
      if (signal.aborted) throw interruption(signal, requestIdentifier(response));
      throw error;
    }
  }

  async respond(request: ResponseInput): Promise<Answer> {
    if (!request.model) throw new AiError('no_model');
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]);
    const input = messageContext(request.messages);
    const search = request.search || (!request.skipAutomaticSearch && likelyNeedsSearch(input.at(-1)!.content));
    const body = { model: request.model, input, store: false, stream: true };

    const send = (useSearch: boolean) => this.authorized('/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        ...body,
        instructions: personality(request.tone, request.length, useSearch, request.locale, request.petName),
        ...(useSearch ? searchFields(request.search) : {}),
      }),
      signal,
    });

    let response = await send(search);
    let searchDenied = false;
    if (!response.ok) {
      const error = await this.httpError(response, signal, 'response-admission', search);
      if (error.code !== 'search_unavailable' || request.search) throw error;
      searchDenied = true;
      response = await send(false);
      if (!response.ok) throw await this.httpError(response, signal, 'response-admission');
    }

    const requestId = requestIdentifier(response);
    const reportUsage = (value: Record<string, unknown>) => request.onUsage?.(
      readTokenUsage(value.usage), typeof value.model === 'string' && value.model.length <= 180 ? value.model : undefined);
    const searchSent = search && !searchDenied;
    const finish = (text: string, sources: Source[], searched: boolean): Answer => {
      const used = searchSent && searched;
      return {
        text,
        sources: used ? sources : [],
        search: used ? 'used' : searchDenied ? 'unavailable' : 'unused',
        warning: searchDenied ? searchUnavailable(request.locale) : search && !used ? searchNotUsed(request.locale) : undefined,
      };
    };
    const media = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
    if (!response.body || !['text/event-stream', 'text/plain', 'application/octet-stream', ''].includes(media)) {
      if (media === 'application/json' || media.endsWith('+json')) {
        const body = asRecord(await response.json().catch(() => undefined));
        if (signal.aborted) throw interruption(signal, requestId);
        if (body.object === 'response') reportUsage(body);
        if (body.error || typeof body.code === 'string') {
          throw responseError(body.error ?? body, requestId, response.status, searchSent, 'response-media');
        }
        // A complete, typed JSON Response can be handled without streaming events.
        if (body.object === 'response' && body.status === 'completed' && Array.isArray(body.output)) {
          const output = completedOutput(body);
          if (output.text.trim()) return finish(output.text, output.sources, output.searched);
        }
        if (body.object === 'response' && body.status === 'incomplete') {
          throw new AiError('incomplete', requestId, response.status, 'response-media');
        }
      }
      void response.body?.cancel().catch(() => {});
      throw new AiError('protocol', requestId, response.status, 'response-media');
    }

    let searched = false;
    const parts = new Map<string, { output: number; content: number; text: string }>();
    const finishedItems: unknown[] = [];
    const annotations: unknown[] = [];
    const rememberPart = (event: Record<string, unknown>, value: unknown, delta: boolean) => {
      if (typeof value !== 'string') return;
      const output = typeof event.output_index === 'number' ? event.output_index : 0;
      const content = typeof event.content_index === 'number' ? event.content_index : 0;
      const key = `${output}:${content}`;
      const prefix = delta ? parts.get(key)?.text ?? '' : '';
      parts.set(key, { output, content, text: prefix + value });
    };
    for await (const event of readEvents(response.body, signal, requestId, response.status)) {
      if (signal.aborted) throw interruption(signal, requestId);
      switch (event.type) {
        case 'response.output_text.delta':
        case 'response.refusal.delta':
          if (typeof event.delta === 'string') {
            rememberPart(event, event.delta, true);
            request.onDelta(event.delta);
          }
          break;
        case 'response.output_text.done':
        case 'response.refusal.done':
          rememberPart(event, event.text ?? event.refusal, false);
          break;
        case 'response.content_part.done': {
          const part = asRecord(event.part);
          if (part.type === 'output_text' || part.type === 'refusal') {
            rememberPart(event, part.text ?? part.refusal, false);
            if (Array.isArray(part.annotations)) annotations.push(...part.annotations);
          }
          break;
        }
        case 'response.output_text.annotation.added':
          annotations.push(event.annotation);
          break;
        case 'response.web_search_call.completed':
          searched = true;
          break;
        case 'response.output_item.done': {
          const item = asRecord(event.item);
          if (item.type === 'web_search_call' && item.status === 'completed') searched = true;
          if (item.type === 'message') finishedItems.push(item);
          break;
        }
        case 'response.completed': {
          const final = asRecord(event.response);
          reportUsage(final);
          if (final.error || final.status === 'failed') {
            throw responseError(final.error, requestId, response.status, searchSent, 'response-stream');
          }
          if (typeof final.status === 'string' && final.status !== 'completed') {
            throw new AiError('incomplete', requestId, response.status, 'response-stream');
          }
          const output = completedOutput(final);
          const finished = completedOutput({ output: finishedItems });
          const reconstructed = [...parts.values()].sort((a, b) => a.output - b.output || a.content - b.content)
            .map(part => part.text).join('\n\n');
          const answer = output.text || finished.text || reconstructed;
          if (!answer.trim()) throw new AiError('incomplete', requestId, response.status, 'response-stream');
          const sources = new Map<string, Source>();
          if (searchSent && (searched || output.searched)) {
            for (const source of [...output.sources, ...finished.sources, ...annotations.map(readCitation)]) {
              if (source && !sources.has(source.url)) sources.set(source.url, source);
            }
          }
          return finish(answer, [...sources.values()], searched || output.searched);
        }
        case 'response.failed':
          reportUsage(asRecord(event.response));
          throw responseError(asRecord(event.response).error ?? event.error ?? event,
            requestId, response.status, searchSent, 'response-stream');
        case 'response.incomplete':
          reportUsage(asRecord(event.response));
          throw new AiError('incomplete', requestId, response.status, 'response-stream');
        case 'error':
          throw responseError(event.error ?? event, requestId, response.status, searchSent, 'response-stream');
      }
    }
    throw new AiError('incomplete', requestId, response.status, 'response-stream');
  }

  private async authorized(path: '/models' | '/responses', init: RequestInit & { signal: AbortSignal }): Promise<Response> {
    const stage = path === '/models' ? 'model-catalog' : 'response-admission';
    const send = async (forceRefresh: boolean) => {
      if (init.signal.aborted) throw interruption(init.signal);
      // Auth errors already carry safe account states from the credential manager.
      const token = await this.getAccessToken(forceRefresh);
      if (init.signal.aborted) throw interruption(init.signal);
      try {
        return await this.fetcher(`${api}${path}`, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
          redirect: 'error',
        });
      } catch {
        throw init.signal.aborted ? interruption(init.signal) : new AiError('network', undefined, undefined, stage);
      }
    };

    const response = await send(false);
    if (response.status !== 401) return response;
    await response.body?.cancel().catch(() => {});
    return send(true);
  }

  private async httpError(response: Response, signal: AbortSignal, stage: AiStage, search = false): Promise<AiError> {
    const requestId = requestIdentifier(response);
    const body = asRecord(await response.json().catch(() => undefined));
    if (signal.aborted) return interruption(signal, requestId);
    return responseError(body.error ?? body, requestId, response.status, search, stage);
  }
}
