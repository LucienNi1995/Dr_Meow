import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { readTokenUsage, type TokenUsage, type UsageRecord, type UsageScan } from '../shared/usage.ts';

type Json = Record<string, any>;
const object = (value: unknown): Json => value !== null && typeof value === 'object' ? value as Json : {};
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
const modelName = (value: unknown) => typeof value === 'string' && value.length <= 180 ? value : 'unknown';
const nonzero = (value?: TokenUsage) => value && value.input + value.output > 0;
const same = (a?: TokenUsage, b?: TokenUsage) => !!a && !!b &&
  a.input === b.input && a.output === b.output && a.cached === b.cached && a.cacheWrite === b.cacheWrite;

function codexTokens(value: unknown): TokenUsage | undefined {
  const item = object(value);
  return readTokenUsage({ input_tokens: item.input_tokens, output_tokens: item.output_tokens,
    input_tokens_details: { cached_tokens: item.cached_input_tokens ?? item.cache_read_input_tokens ?? 0,
      cache_write_tokens: item.cache_write_input_tokens ?? 0 },
    output_tokens_details: { reasoning_tokens: item.reasoning_output_tokens ?? 0 } });
}

// Parse metadata only. Message content, tool arguments, paths and credentials
// never become part of the imported database rows.
export class SessionUsageParser {
  private source: 'claude' | 'codex';
  private model = 'unknown';
  private session: string;
  private sequence = 0;
  private previous?: TokenUsage;
  private pending?: UsageRecord;
  readonly records = new Map<string, UsageRecord>();
  malformed = 0;
  constructor(source: 'claude' | 'codex', fileId: string) { this.source = source; this.session = fingerprint(fileId); }

  line(line: string) {
    let event: Json;
    try { event = object(JSON.parse(line)); } catch { this.malformed++; return; }
    const payload = object(event.payload);
    if (event.type === 'session_meta' && typeof payload.id === 'string') this.session = fingerprint(payload.id);
    if (event.type === 'turn_context' || payload.type === 'thread_settings_applied') this.model = modelName(payload.model);
    const at = Date.parse(event.timestamp);
    if (!Number.isFinite(at)) return;
    if (this.source === 'claude' && event.type === 'assistant') {
      const message = object(event.message), usage = object(message.usage);
      if (typeof message.id !== 'string') return;
      const cached = usage.cache_read_input_tokens ?? 0;
      const cacheWrite = usage.cache_creation_input_tokens ?? 0;
      if (![usage.input_tokens, usage.output_tokens, cached, cacheWrite].every(value =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return;
      const tokens = readTokenUsage({ input_tokens: usage.input_tokens + cached + cacheWrite,
        output_tokens: usage.output_tokens, input_tokens_details: { cached_tokens: cached, cache_write_tokens: cacheWrite } });
      if (!tokens) return;
      const id = 'claude:' + fingerprint(message.id);
      const prior = this.records.get(id);
      // Repeated content blocks describe the same API message. Retain the
      // largest observed counters rather than summing streamed snapshots.
      if (prior?.tokens && prior.tokens.output > tokens.output) return;
      this.records.set(id, { id, source: 'claude', at: prior?.at ?? at, model: modelName(message.model), status: 'complete', tokens });
    }
    if (this.source !== 'codex') return;
    if (event.type === 'token_usage_record') {
      this.flushPending();
      const tokens = codexTokens(payload.usage);
      if (nonzero(tokens)) {
        const key = typeof payload.response_id === 'string' ? payload.response_id : `${at}:${this.sequence++}`;
        this.pending = { id: `codex:${this.session}:response:${fingerprint(key)}`, source: 'codex', at,
          model: modelName(payload.model ?? this.model), status: 'complete', tokens };
      }
      return;
    }
    if (event.type !== 'event_msg' || payload.type !== 'token_count') return;
    this.sequence++;
    const info = object(payload.info);
    this.model = modelName(info.model ?? info.model_name ?? payload.model ?? this.model);
    const total = codexTokens(info.total_token_usage);
    const last = codexTokens(info.last_token_usage);
    const duplicate = same(total, this.previous);
    let tokens = last;
    if (!tokens && total) {
      const before = this.previous;
      tokens = before ? {
        input: Math.max(0, total.input - before.input), output: Math.max(0, total.output - before.output),
        cached: Math.max(0, total.cached - before.cached), cacheWrite: Math.max(0, total.cacheWrite - before.cacheWrite),
        reasoning: Math.max(0, total.reasoning - before.reasoning),
      } : undefined;
      // The initial total may include a parent/forked session. Establish a
      // baseline instead of charging inherited history to this file.
      if (!before) this.malformed++;
      // A reset without per-request usage cannot be attributed reliably.
      if (before && (total.input < before.input || total.output < before.output)) { tokens = undefined; this.malformed++; }
    }
    if (total) this.previous = total;
    if (this.pending && same(last, this.pending.tokens)) {
      if (!duplicate) this.records.set(this.pending.id, this.pending);
      this.pending = undefined;
      return;
    }
    if (this.pending && last && !nonzero(last)) this.flushPending();
    else this.pending = undefined;
    if (!duplicate && nonzero(tokens) && tokens!.cached + tokens!.cacheWrite <= tokens!.input) {
      const id = `codex:${this.session}:event:${fingerprint(JSON.stringify([at, this.model, total ?? last]))}`;
      this.records.set(id, { id, source: 'codex', at, model: this.model, status: 'complete', tokens });
    }
  }

  private flushPending() {
    if (this.pending) this.records.set(this.pending.id, this.pending);
    this.pending = undefined;
  }

  finish(): UsageRecord[] { this.flushPending(); return [...this.records.values()]; }
}

export class SessionUsageScanner {
  private running?: Promise<UsageScan>;
  private stamps = new Map<string, string>();
  private generation = 0;
  private readonly roots: { claude: string; codex: string };
  constructor(roots = {
    claude: join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects'),
    codex: join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'),
  }) { this.roots = roots; }

  scan(save: (records: UsageRecord[]) => void): Promise<UsageScan> {
    if (this.running) return this.running;
    this.running = this.perform(save).finally(() => { this.running = undefined; });
    return this.running;
  }

  reset() { this.generation++; this.stamps.clear(); }

  private async perform(save: (records: UsageRecord[]) => void): Promise<UsageScan> {
    const generation = this.generation;
    const result: UsageScan = { enabled: true, at: Date.now(), files: 0, imported: 0, skipped: 0, malformed: 0, unavailable: 0 };
    let bytes = 0;
    const visit = async (directory: string, source: 'claude' | 'codex', depth = 0): Promise<void> => {
      if (depth > 10) { result.skipped++; return; }
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.unavailable++; return; }
      for (const entry of entries) {
        if (result.files >= 5000) { result.skipped++; continue; }
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { await visit(path, source, depth + 1); continue; }
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        result.files++;
        try {
          const metadata = await stat(path);
          const stamp = `${metadata.mtimeMs}:${metadata.size}`;
          if (this.stamps.get(path) === stamp) continue;
          if (metadata.size > 64 * 1024 * 1024 || bytes + metadata.size > 256 * 1024 * 1024) { result.skipped++; continue; }
          bytes += metadata.size;
          const parser = new SessionUsageParser(source, path);
          const input = createReadStream(path, { encoding: 'utf8', end: Math.max(0, metadata.size - 1) });
          const lines = createInterface({ input, crlfDelay: Infinity });
          let incomplete = false;
          try { for await (const line of lines) {
            if (line.length > 4 * 1024 * 1024) { result.malformed++; incomplete = true; continue; }
            parser.line(line);
          } } finally { lines.close(); input.destroy(); }
          const records = parser.finish();
          save(records);
          result.imported += records.length;
          result.malformed += parser.malformed;
          // Retry a truncated final JSON line on the next scan.
          if (!parser.malformed && !incomplete && generation === this.generation) this.stamps.set(path, stamp);
        } catch { result.unavailable++; }
      }
    };
    await visit(this.roots.claude, 'claude');
    await visit(this.roots.codex, 'codex');
    return result;
  }
}
