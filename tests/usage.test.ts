import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, appendFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTokenUsage, estimatedCost, summarizeUsage, validPrice, type UsageRecord } from '../shared/usage.ts';
import { SessionUsageParser, SessionUsageScanner } from '../electron/usageSessions.ts';
import { LocalDatabase } from '../electron/database.ts';
import { AiService } from '../electron/ai/responsesClient.ts';

const tokens = { input: 1000, output: 100, cached: 400, cacheWrite: 100, reasoning: 20 };
const price = { model: 'test-model', input: 2, output: 10, cached: 0.2, cacheWrite: 2.5 };
const at = '2026-11-01T12:00:00Z';
const raw = (input: number, output: number, cached = 0) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: cached });
const event = (payload: object) => JSON.stringify({ type: 'event_msg', timestamp: at, payload: { type: 'token_count', ...payload } });

test('usage preserves inclusive cache/reasoning semantics and refuses malformed counts', () => {
  assert.deepEqual(readTokenUsage({ input_tokens: 1000, output_tokens: 100,
    input_tokens_details: { cached_tokens: 400, cache_write_tokens: 100 },
    output_tokens_details: { reasoning_tokens: 20 } }), tokens);
  for (const value of [null, {}, { input_tokens: -1, output_tokens: 2 },
    { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 11 } },
    { input_tokens: 10, output_tokens: 1.5 }]) assert.equal(readTokenUsage(value), undefined);
  assert.equal(estimatedCost(tokens, price), 0.00233);
  assert.equal(estimatedCost(tokens, undefined), undefined);
  assert.equal(validPrice({ ...price, input: NaN }), false);
  assert.equal(validPrice({ ...price, input: -1 }), false);
  assert.equal(validPrice({ ...price, input: 0 }), true);
});

test('summaries distinguish missing usage and missing prices from zero-cost requests', () => {
  const records: UsageRecord[] = [
    { id: 'a', source: 'meow', model: 'test-model', at: 1, status: 'complete', tokens },
    { id: 'b', source: 'codex', model: 'unpriced', at: 2, status: 'complete', tokens },
    { id: 'c', source: 'meow', model: 'test-model', at: 3, status: 'cancelled' },
  ];
  const result = summarizeUsage(records, [price]);
  assert.equal(result.requests, 3); assert.equal(result.unknown, 1); assert.equal(result.unpriced, 1);
  assert.equal(result.input + result.output, 2200); assert.equal(result.cost, 0.00233);
});

test('Claude streamed blocks deduplicate message IDs and normalize exclusive input cache counters', () => {
  const parser = new SessionUsageParser('claude', 'file');
  for (const output of [3, 10, 5]) parser.line(JSON.stringify({ type: 'assistant', timestamp: at,
    message: { id: 'same-message', model: 'claude-test', content: [{ text: 'PRIVATE PROMPT' }],
      usage: { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 50, cache_creation_input_tokens: 25 } } }));
  const rows = parser.finish();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].tokens, { input: 175, output: 10, cached: 50, cacheWrite: 25, reasoning: 0 });
  assert.equal(JSON.stringify(rows).includes('PRIVATE PROMPT'), false);
});

test('Codex repeated cumulative snapshots do not double count, and last usage survives model changes', () => {
  const parser = new SessionUsageParser('codex', 'file');
  parser.line(JSON.stringify({ type: 'session_meta', payload: { id: 'session' } }));
  parser.line(JSON.stringify({ type: 'turn_context', payload: { model: 'first-model' } }));
  const first = event({ info: { total_token_usage: raw(100, 10, 20), last_token_usage: raw(100, 10, 20) } });
  parser.line(first); parser.line(first);
  parser.line(JSON.stringify({ type: 'turn_context', payload: { model: 'second-model' } }));
  parser.line(event({ info: { total_token_usage: raw(160, 15, 25), last_token_usage: raw(60, 5, 5) } }));
  const rows = parser.finish();
  assert.equal(rows.length, 2); assert.equal(rows[1].model, 'second-model');
  assert.equal(rows.reduce((sum, row) => sum + row.tokens!.input, 0), 160);
});

test('Codex standalone response usage and its matching token snapshot are one request', () => {
  const parser = new SessionUsageParser('codex', 'file');
  parser.line(JSON.stringify({ type: 'token_usage_record', timestamp: at, payload: { response_id: 'resp_1', usage: raw(100, 10) } }));
  parser.line(event({ info: { total_token_usage: raw(100, 10), last_token_usage: raw(100, 10) } }));
  assert.equal(parser.finish().length, 1);
  const standalone = new SessionUsageParser('codex', 'other');
  standalone.line(JSON.stringify({ type: 'token_usage_record', timestamp: at, payload: { response_id: 'resp_2', usage: raw(20, 2) } }));
  assert.equal(standalone.finish()[0].tokens?.input, 20);
});

test('Codex cumulative-only history establishes a baseline and refuses ambiguous counter resets', () => {
  const parser = new SessionUsageParser('codex', 'file');
  parser.line(event({ info: { total_token_usage: raw(1000, 100) } }));
  parser.line(event({ info: { total_token_usage: raw(1100, 110) } }));
  parser.line(event({ info: { total_token_usage: raw(10, 1) } }));
  const rows = parser.finish();
  assert.equal(rows.length, 1); assert.equal(rows[0].tokens?.input, 100);
  assert.equal(parser.malformed, 2);
});

test('usage persists separately from chats, repeated imports upsert, and clearing blocks historical reimport', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meow-usage-db-'));
  let db = new LocalDatabase(join(directory, 'usage.sqlite'));
  try {
    const row: UsageRecord = { source: 'meow', id: 'request-1', at: Date.now() - 1000, model: price.model, status: 'complete', tokens };
    db.importUsage([row, row]); db.setUsagePrice(price); db.clearChats();
    assert.equal(db.usage().records.length, 1);
    db.recordUsage({ ...row, status: 'running' });
    db.close(); db = new LocalDatabase(join(directory, 'usage.sqlite'));
    assert.equal(db.usage().records.length, 1); assert.deepEqual(db.usage().prices, [price]);
    assert.equal(db.usage().records[0].status, 'cancelled');
    db.clearUsage(); db.recordUsage(row);
    assert.equal(db.usage().records.length, 0); assert.equal(db.usage().prices.length, 1);
    db.recordUsage({ ...row, at: Date.now() + 10 }); assert.equal(db.usage().records.length, 1);
    db.clearAll(); assert.equal(db.usage().records.length, 0); assert.equal(db.usage().prices.length, 0);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('scanner handles repeated scans, appended log records, malformed lines and symlinks without retaining content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meow-usage-scan-'));
  try {
    const roots = { claude: join(directory, 'claude'), codex: join(directory, 'codex') };
    await mkdir(roots.claude); await mkdir(roots.codex);
    const path = join(roots.codex, 'session.jsonl');
    await writeFile(path, event({ info: { total_token_usage: raw(100, 10), last_token_usage: raw(100, 10) } }) + '\n');
    await symlink(path, join(roots.codex, 'duplicate.jsonl'));
    const rows = new Map<string, UsageRecord>();
    const scanner = new SessionUsageScanner(roots);
    const save = (items: UsageRecord[]) => { for (const row of items) rows.set(row.id, row); };
    const first = await scanner.scan(save); assert.equal(first.files, 1); assert.equal(rows.size, 1);
    const second = await scanner.scan(save); assert.equal(second.imported, 0);
    await appendFile(path, event({ info: { total_token_usage: raw(150, 15), last_token_usage: raw(50, 5) } }) + '\n{truncated');
    const third = await scanner.scan(save); assert.equal(third.malformed, 1); assert.equal(rows.size, 2);
    scanner.reset(); await scanner.scan(save); assert.equal(rows.size, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Responses usage is reported for SSE, JSON, and incomplete terminal responses', async () => {
  const request = { model: 'requested', messages: [{ id: 'u', role: 'user' as const, text: 'hello', createdAt: 0 }],
    tone: 'normal' as const, length: 'short' as const, search: false, signal: new AbortController().signal, onDelta() {} };
  const response = { object: 'response', status: 'completed', model: 'returned',
    usage: { input_tokens: 12, output_tokens: 4, input_tokens_details: { cached_tokens: 3 } },
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] }] };
  for (const json of [false, true]) {
    let observed;
    const client = new AiService(async () => 'mock', { fetch: async () => json ? Response.json(response) :
      new Response(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) });
    await client.respond({ ...request, onUsage: (tokens, model) => { observed = { tokens, model }; } });
    assert.deepEqual(observed, { model: 'returned', tokens: { input: 12, output: 4, cached: 3, cacheWrite: 0, reasoning: 0 } });
  }
  let seen = false;
  const client = new AiService(async () => 'mock', { fetch: async () => new Response(
    `data: ${JSON.stringify({ type: 'response.incomplete', response })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) });
  await assert.rejects(client.respond({ ...request, onUsage: () => { seen = true; } }));
  assert.equal(seen, true);
});
