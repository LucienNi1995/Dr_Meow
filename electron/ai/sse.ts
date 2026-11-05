import { AiError } from './aiError.ts';

export function interruption(signal: AbortSignal, requestId?: string): AiError {
  return new AiError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', requestId);
}

export async function* readEvents(
  stream: ReadableStream<Uint8Array>, signal: AbortSignal, requestId?: string, status?: number,
): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let data: string[] = [];
  let dataLength = 0;
  let eventName = '';
  let sawFraming = false;
  const unreadable = () => new AiError('protocol', requestId, status, 'response-stream');
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });

  try {
    while (true) {
      if (signal.aborted) throw interruption(signal, requestId);
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw signal.aborted ? interruption(signal, requestId) : new AiError('network', requestId, status, 'response-stream');
      }
      if (signal.aborted) throw interruption(signal, requestId);
      pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      // The connection may close immediately after a complete final JSON event.
      if (chunk.done) pending += '\n\n';

      let end: number;
      while ((end = pending.search(/[\r\n]/)) >= 0) {
        // A CRLF may straddle network chunks.
        if (end === pending.length - 1 && pending[end] === '\r' && !chunk.done) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + (pending.slice(end, end + 2) === '\r\n' ? 2 : 1));

        if (line.startsWith(':') || /^(?:id|retry):/.test(line)) sawFraming = true;
        if (line.startsWith('event:')) {
          sawFraming = true;
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:') || line === 'data') {
          sawFraming = true;
          const value = line.slice(line[5] === ' ' ? 6 : 5);
          dataLength += value.length + 1;
          if (dataLength > 4_000_000) throw unreadable();
          data.push(value);
        } else if (!line) {
          const type = eventName;
          const payload = data.join('\n').trim();
          data = [];
          dataLength = 0;
          eventName = '';
          if (!payload || payload === '[DONE]' || type === 'ping' || type === 'heartbeat') continue;
          let event: unknown;
          try {
            event = JSON.parse(payload);
          } catch {
            throw unreadable();
          }
          if (!event || typeof event !== 'object' || Array.isArray(event)) throw unreadable();
          const record = event as Record<string, unknown>;
          yield typeof record.type === 'string' || !type ? record : { ...record, type };
        }
      }

      if (pending.length > 4_000_000) throw unreadable();
      if (chunk.done) {
        if (!sawFraming) throw unreadable();
        return;
      }
    }
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
    reader.releaseLock();
  }
}
