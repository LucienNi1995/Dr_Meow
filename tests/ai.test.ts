import assert from 'node:assert/strict';
import test from 'node:test';
import { AiError, AiService } from '../electron/ai/responsesClient.ts';
import type { Message } from '../shared/contracts.ts';

function message(role: Message['role'], text: string, status?: Message['status']): Message {
  return { id: `${role}-${text}`, role, text, status, createdAt: 0 };
}

function request(overrides: Partial<Parameters<AiService['respond']>[0]> = {}) {
  return {
    model: 'mock-account-model',
    messages: [message('user', '为什么天空是蓝色的？')],
    tone: 'normal' as const,
    length: 'standard' as const,
    search: false,
    signal: new AbortController().signal,
    onDelta: () => {},
    ...overrides,
  };
}

function stream(events: object[], chunkSize = 13) {
  const payload = ': keepalive\r\n\r\n' + events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('');
  const bytes = new TextEncoder().encode(payload);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let start = 0; start < bytes.length; start += chunkSize) {
        controller.enqueue(bytes.slice(start, start + chunkSize));
      }
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'x-request-id': 'req_mock' } });
}

function delta(text: string) {
  return { type: 'response.output_text.delta', delta: text };
}

function completed(text: string, annotations: object[] = [], searched = false) {
  const search = { type: 'web_search_call', status: 'completed' };
  const reply = {
    type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations }],
  };
  return { type: 'response.completed', response: { output: searched ? [search, reply] : [reply] } };
}

function mockClient(fetcher: typeof fetch) {
  return new AiService(async () => 'test-oauth-access-token', { fetch: fetcher });
}

test('lists only selectable account models in server order and refreshes once on HTTP 401', async () => {
  const refreshCalls: (boolean | undefined)[] = [];
  const client = new AiService(async force => {
    refreshCalls.push(force);
    return force ? 'new-token' : 'old-token';
  }, {
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/models');
      assert.equal(options?.redirect, 'error');
      const bearer = new Headers(options?.headers).get('Authorization');
      if (bearer === 'Bearer old-token') return new Response(null, { status: 401 });
      assert.equal(bearer, 'Bearer new-token');
      return Response.json({ models: [
        { slug: 'ordered-b', visibility: 'list', display_name: 'Model B' },
        { slug: 'hidden', visibility: 'hide', display_name: 'Hidden' },
        { slug: 'ordered-a', visibility: 'list', display_name: 'Model A' },
        { slug: 'ordered-a', visibility: 'list', display_name: 'Duplicate' },
      ] });
    },
  });

  assert.deepEqual(await client.models(), [
    { id: 'ordered-b', name: 'Model B' }, { id: 'ordered-a', name: 'Model A' },
  ]);
  assert.deepEqual(refreshCalls, [false, true]);
});

test('supports the official REST models list envelope without treating it as malformed SIWC JSON', async () => {
  const client = mockClient(async (_url, options) => {
    assert.equal(new Headers(options?.headers).get('Accept'), 'application/json');
    return Response.json({ object: 'list', data: [
      { id: 'available-model', object: 'model', created: 1686935002, owned_by: 'openai' },
      { id: 'hidden-model', object: 'model', visibility: 'hide' },
      { id: 'labelled-model', object: 'model', visibility: 'list', display_name: 'Labelled model' },
    ] });
  });

  assert.deepEqual(await client.models(), [
    { id: 'available-model', name: 'available-model' }, { id: 'labelled-model', name: 'Labelled model' },
  ]);
});

test('reports model schema failures separately and retains only a safe request ID', async () => {
  const headers = { 'x-request-id': 'req_schema_42' };
  const client = mockClient(async () => Response.json({ data: ['not a model catalog'] }, { headers }));
  await assert.rejects(client.models(), (error: unknown) => {
    assert.ok(error instanceof AiError);
    assert.equal(error.code, 'protocol');
    assert.equal(error.stage, 'model-catalog');
    assert.equal(error.requestId, 'req_schema_42');
    assert.match(error.localized('en'), /model list/);
    return true;
  });
});

test('accepts SSE framing with event names, keep-alives and a final event without a blank delimiter', async () => {
  const chunks = [
    '\ufeff: keep-alive\r\n\r\n',
    'data: \r\n\r\n',
    'event: heartbeat\r\ndata: alive\r\n\r\n',
    'event: response.output_text.delta\r\ndata: {"delta":"Hello"}\r\n\r\n',
    'event: response.output_text.done\r\ndata: {"text":"Hello, world!"}\r\n\r\n',
    'event: response.completed\r\ndata: {"response":{"status":"completed","output":[]}}',
  ];
  const deltas: string[] = [];
  const client = mockClient(async () => new Response(chunks.join(''), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  }));
  const answer = await client.respond(request({ onDelta: text => deltas.push(text) }));
  assert.equal(answer.text, 'Hello, world!');
  assert.deepEqual(deltas, ['Hello']);
});

test('preserves terminal output item text and streamed citations even if the completed output is empty', async () => {
  const client = mockClient(async () => stream([
    { type: 'response.web_search_call.completed' },
    { type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', url: 'https://example.org/doc' } },
    { type: 'response.output_item.done', item: {
      type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Official documentation' }],
    } },
    { type: 'response.completed', response: { status: 'completed', output: [] } },
  ]));
  const answer = await client.respond(request({ search: true }));
  assert.equal(answer.text, 'Official documentation');
  assert.equal(answer.search, 'used');
  assert.deepEqual(answer.sources, [{ title: 'example.org', url: 'https://example.org/doc' }]);
});

test('uses a verified completed JSON Response if the endpoint supplies it as a single result', async () => {
  const final = completed('A full answer', [{ type: 'url_citation', url: 'https://example.org/doc' }], true);
  const client = mockClient(async (_url, options) => {
    assert.equal(JSON.parse(String(options?.body)).stream, true);
    return Response.json({ ...final.response, object: 'response', status: 'completed' });
  });
  const answer = await client.respond(request({ search: true, onDelta: () => assert.fail('JSON is not a stream') }));
  assert.equal(answer.text, 'A full answer');
  assert.equal(answer.search, 'used');
  assert.deepEqual(answer.sources, [{ title: 'example.org', url: 'https://example.org/doc' }]);

  const incomplete = mockClient(async () => Response.json({ ...final.response, object: 'response', status: 'incomplete' }));
  await assert.rejects(incomplete.respond(request()), { code: 'incomplete', stage: 'response-media' });
  const wrongShape = mockClient(async () => Response.json({ ...final.response, status: 'completed' }));
  await assert.rejects(wrongShape.respond(request()), { code: 'protocol', stage: 'response-media' });
});

test('distinguishes admission, unexpected media and malformed stream failures without exposing the response', async () => {
  const admission = mockClient(async () => Response.json({ detail: 'internal diagnostic' }, { status: 403 }));
  await assert.rejects(admission.respond(request()), { code: 'permission', stage: 'response-admission', status: 403 });
  const serviceError = mockClient(async () => Response.json({ error: { code: 'subscription_sharing_usage_unavailable' } }));
  await assert.rejects(serviceError.respond(request()), { code: 'unavailable', stage: 'response-media', status: 200 });

  const html = mockClient(async () => new Response('<html>gateway placeholder</html>', {
    headers: { 'Content-Type': 'text/html', 'x-request-id': 'req_proxy' },
  }));
  await assert.rejects(html.respond(request()), { code: 'protocol', stage: 'response-media', requestId: 'req_proxy' });

  const broken = mockClient(async () => new Response('event: message\ndata: {broken\n\n', {
    headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'should not expose this' },
  }));
  await assert.rejects(broken.respond(request()), (error: unknown) => {
    assert.ok(error instanceof AiError);
    assert.equal(error.code, 'protocol');
    assert.equal(error.stage, 'response-stream');
    assert.equal(error.requestId, undefined);
    assert.doesNotMatch(error.message, /broken/);
    return true;
  });
});

test('sends a bounded local conversation and streams split UTF-8/CRLF deltas through completion', async () => {
  const received: string[] = [];
  const history = Array.from({ length: 10 }, (_, index) => [
    message('user', `Question ${index}`), message('assistant', `Answer ${index}`, 'complete'),
  ]).flat();
  history.push(message('user', 'Aborted question'), message('assistant', 'Partial text', 'cancelled'));
  history.push(message('user', 'Can you explain the last answer?'));

  const client = mockClient(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options?.method, 'POST');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-oauth-access-token');
    assert.equal(headers.get('Accept'), 'text/event-stream');
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'store', 'stream']);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(body.model, 'mock-account-model');
    assert.match(body.instructions, /Dr\. Meow/);
    assert.match(body.instructions, /Lead with the answer/);
    assert.match(body.instructions, /professional voice/);
    assert.deepEqual(body.input.map((entry: { content: string }) => entry.content),
      history.slice(4, 20).map(entry => entry.text).concat('Can you explain the last answer?'));
    return stream([delta('蓝色'), delta('来自散射。'), completed('蓝色来自散射。')], 1);
  });

  const answer = await client.respond(request({ messages: history, tone: 'professional', length: 'short',
    onDelta: text => received.push(text) }));
  assert.deepEqual(received, ['蓝色', '来自散射。']);
  assert.equal(answer.text, '蓝色来自散射。');
  assert.equal(answer.search, 'unused');
});

test('explicit search uses the official tool and emits only safe, unique real citations', async () => {
  const citations = [
    { type: 'url_citation', url: 'https://example.org/paper', title: 'Research Paper' },
    { type: 'url_citation', url: 'https://example.org/paper', title: 'Duplicate' },
    { type: 'url_citation', url: 'javascript:alert(1)', title: 'Unsafe' },
    { type: 'url_citation', url: 'https://me:pass@example.org/', title: 'Credentials' },
  ];
  const client = mockClient(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(body.tools, [{ type: 'web_search' }]);
    assert.equal(body.tool_choice, 'required');
    return stream([delta('研究摘要'), completed('研究摘要', citations, true)]);
  });
  const answer = await client.respond(request({ search: true }));
  assert.equal(answer.search, 'used');
  assert.deepEqual(answer.sources, [{ url: 'https://example.org/paper', title: 'Research Paper' }]);
});

test('reports explicit search restrictions and falls back to plain chat for inferred search', async () => {
  const sent: { tools?: unknown; tool_choice?: string }[] = [];
  const client = mockClient(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    sent.push(body);
    if (body.tools) return Response.json({
      error: { code: 'subscription_sharing_unsupported_capability', param: 'tools[0]' },
    }, { status: 400 });
    assert.match(body.instructions, /no web search/);
    return stream([completed('无法核实今天的新闻。')]);
  });

  await assert.rejects(client.respond(request({ search: true })), { code: 'search_unavailable' });
  assert.equal(sent.length, 1);
  const answer = await client.respond(request({ messages: [message('user', '今天有什么 AI 新闻？')] }));
  assert.equal(sent[1].tool_choice, 'auto');
  assert.equal(sent[2].tools, undefined);
  assert.equal(answer.search, 'unavailable');
  assert.match(answer.warning ?? '', /暂不支持联网搜索/);
  assert.deepEqual(answer.sources, []);
});

test('plain retry suppresses automatic search and a citation alone never implies search ran', async () => {
  const client = mockClient(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.tools, undefined);
    return stream([completed('普通回答', [{ type: 'url_citation', url: 'https://example.org/' }])]);
  });
  const answer = await client.respond(request({
    messages: [message('user', '今天有什么 AI 新闻？')], skipAutomaticSearch: true,
  }));
  assert.equal(answer.search, 'unused');
  assert.deepEqual(answer.sources, []);
});

test('localizes search warnings and errors while preserving the user’s reply language', async () => {
  const client = mockClient(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.match(body.instructions, /Respond in the user’s language/);
    assert.match(body.instructions, /use English/);
    if (body.tools) return Response.json({
      error: { code: 'subscription_sharing_unsupported_capability', param: 'tools[0]' },
    }, { status: 400 });
    return stream([completed('I could not verify today’s news.')]);
  });

  const messages = [message('user', 'Find the latest news')];
  const answer = await client.respond(request({ locale: 'en', messages }));
  assert.equal(answer.warning, 'Web search is unavailable for this account or model.');
  await assert.rejects(client.respond(request({ locale: 'en', search: true, messages })), (error: unknown) => {
    assert.ok(error instanceof AiError);
    assert.match(error.localized('en'), /You can continue chatting with search turned off/);
    return true;
  });
});

test('distinguishes terminal quota and incomplete stream errors from success', async () => {
  const client = mockClient(async () => stream([delta('partial'), {
    type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
  }]));
  await assert.rejects(client.respond(request()), { code: 'limit', requestId: 'req_mock' });

  const truncated = mockClient(async () => stream([delta('partial')]));
  await assert.rejects(truncated.respond(request()), { code: 'incomplete' });
  const incomplete = mockClient(async () => stream([{ type: 'response.incomplete' }]));
  await assert.rejects(incomplete.respond(request()), { code: 'incomplete' });
});

test('cancels an active stream and frees its reader', async () => {
  const abort = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta('first'))}\n\n`));
    },
    cancel() { cancelled = true; },
  });
  const client = mockClient(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  await assert.rejects(client.respond(request({ signal: abort.signal, onDelta: () => abort.abort() })), { code: 'cancelled' });
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('cancellation takes precedence over a completion event already buffered', async () => {
  const abort = new AbortController();
  const client = mockClient(async () => stream([delta('first'), completed('first')], 4096));
  await assert.rejects(client.respond(request({ signal: abort.signal, onDelta: () => abort.abort() })), { code: 'cancelled' });
});

test('preserves network failure as a retriable user-facing state without leaking raw error data', async () => {
  let attempt = 0;
  const client = mockClient(async () => {
    if (++attempt === 1) throw new Error('test-oauth-access-token');
    return stream([completed('Reconnected')]);
  });
  await assert.rejects(client.respond(request()), error => {
    assert.ok(error instanceof AiError);
    assert.equal(error.code, 'network');
    assert.doesNotMatch(error.message, /test-oauth-access-token/);
    return true;
  });
  assert.equal((await client.respond(request())).text, 'Reconnected');
});
