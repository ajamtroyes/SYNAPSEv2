// Proves, against a real TrueForge, the behaviour the extension relies on. It needs no API key: a
// scripted model and a small MCP server stand in for the provider and the editor.
//
//   npm run trueforge        (in another terminal)
//   npm run smoke            add -- --write to save docs/research/smoke-results.md
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startMockModel } from '../../examples/mock-model/mock-model.mjs';

const BASE = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const MCP_NAME = 'smoke-editor';
const LIVE = 'smoke-live/mock';
const DEAD = 'smoke-dead/mock';
const BAD_KEY = 'smoke-badkey/mock';

const results = [];
const notes = [];

async function check(name, run) {
  const started = performance.now();
  try {
    const detail = await run();
    results.push({ name, ok: true, ms: Math.round(performance.now() - started), detail: detail ?? '' });
    console.log(`PASS  ${name}${detail ? `: ${detail}` : ''}`);
    return true;
  } catch (error) {
    results.push({ name, ok: false, ms: Math.round(performance.now() - started), detail: error.message });
    console.log(`FAIL  ${name}: ${error.message}`);
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function api(method, path, body) {
  const response = await fetch(new URL(path, BASE), {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json;
  try {
    json = text === '' ? {} : JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, ok: response.ok, json, text };
}

async function must(method, path, body) {
  const result = await api(method, path, body);
  assert(result.ok, `${method} ${path} returned ${result.status}: ${result.text.slice(0, 400)}`);
  return result.json;
}

/** Reads a turn's SSE stream in wire format. `onEvent` may act mid-stream, as cancel does. */
async function streamTurn(sessionId, input, onEvent = () => undefined) {
  const response = await fetch(new URL(`/api/v1/sessions/${sessionId}/turns`, BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ input, stream: true }),
  });
  assert(response.ok, `POST turns returned ${response.status}: ${await response.clone().text()}`);
  const events = [];
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
      if (data !== '') {
        const event = JSON.parse(data);
        events.push(event);
        await onEvent(event, events);
      }
    }
  }
  return events;
}

const terminal = events => events.find(event => event.type === 'turn.done')?.state;
const userMessage = content => [{ type: 'user.message', content }];
const CONFIG = {
  sandbox: { enabled: false },
  generative_ui: { enabled: false },
  ask_user_questions: { enabled: false },
  dynamic_sub_agents: { enabled: false },
  context_management: { compaction: { enabled: false }, large_tool_response: { enabled: false } },
  iteration_limit: 6,
};
const spec = (model, mcp = {}) => ({
  model: { name: model },
  instructions: 'Smoke test agent.',
  mcp_servers: [{ name: MCP_NAME, preload: true, require_approval_for_tools: ['smoke_write'], ...mcp }],
  config: CONFIG,
});
const newSession = async agentSpec => (await must('POST', '/api/v1/sessions', { agent: { spec: agentSpec } })).data.id;

/** Reads the merged tool call the way the extension's review does, from the persisted events. */
async function pendingCall(sessionId, events) {
  const approval = events.find(event => event.type === 'tool.approval_required');
  assert(approval, `No tool.approval_required. Event types: ${[...new Set(events.map(event => event.type))].join(', ')}`);
  const turnId = events.find(event => event.type === 'turn.created')?.turn_id;
  const stored = await must('GET', `/api/v1/sessions/${sessionId}/turns/${turnId}/events`);
  const ref = approval.tool_calls[0];
  const message = stored.data.find(event => event.id === ref.source_event_id);
  const call = message?.tool_calls?.find(candidate => candidate.id === ref.id);
  assert(call, 'The approval did not point at a model.message holding the tool call');
  return { threadId: approval.thread_id, call };
}

function startSmokeMcp(onCall) {
  const token = randomBytes(16).toString('hex');
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const server = new Server({ name: MCP_NAME, version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          // Deliberately unlabelled, as our gated tools must work by name rather than by annotation.
          name: 'smoke_write',
          description: 'Pretends to write a file.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, request => {
      onCall(request.params.name, request.params.arguments);
      return { content: [{ type: 'text', text: 'written' }] };
    });
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  return new Promise(resolve => {
    http.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${http.address().port}/mcp`,
        token,
        close: () => {
          http.close();
          http.closeAllConnections();
        },
      });
    });
  });
}

const health = await fetch(new URL('/healthz', BASE)).then(
  response => (response.ok ? response.json() : undefined),
  () => undefined,
);
if (!health) {
  console.error(`TrueForge is not reachable at ${BASE}. Start it first with: npm run trueforge`);
  process.exit(2);
}
console.log(`TrueForge ${health.version ?? '(version not reported)'} at ${BASE}\n`);

const mcpCalls = [];
const mock = await startMockModel();
const mcp = await startSmokeMcp((name, args) => mcpCalls.push({ name, args }));
const models = [{ name: 'mock', model_id: 'mock', properties: { context_length: 100000, max_output_tokens: 4096 } }];
const provider = (name, baseUrl, modelList = models) => ({ manifest: { type: 'custom', name, base_url: baseUrl, auth: { api_key: 'not-a-real-key' }, models: modelList } });

try {
  await check('register custom providers on loopback', async () => {
    await must('PUT', '/api/v1/settings/model-providers', provider('smoke-live', mock.baseUrl));
    await must('PUT', '/api/v1/settings/model-providers', provider('smoke-dead', 'http://127.0.0.1:9/v1'));
    await must('PUT', '/api/v1/settings/model-providers', provider('smoke-badkey', mock.baseUrl, [{ ...models[0], model_id: 'mock-401' }]));
  });

  const loopback = await check('TrueForge reaches an MCP server on 127.0.0.1 (needs OUTBOUND_URL_ALLOWED_HOSTS)', async () => {
    await must('PUT', '/api/v1/settings/mcp-servers', {
      manifest: { type: 'remote', name: MCP_NAME, url: mcp.url, description: 'Smoke test tools', auth: { type: 'header', headers: { Authorization: `Bearer ${mcp.token}` } } },
    });
    const tools = await must('GET', `/api/v1/mcp-servers/${MCP_NAME}/tools`);
    assert(JSON.stringify(tools).includes('smoke_write'), `Tool not listed: ${JSON.stringify(tools).slice(0, 300)}`);
  });
  if (!loopback) {
    notes.push('Loopback failed, so later checks would fail for the same reason. Start TrueForge with `npm run trueforge`, which sets OUTBOUND_URL_ALLOWED_HOSTS.');
    throw new Error('Stopping: the agent cannot reach any tool.');
  }

  await check('tokens stream as model.message.delta and the stream ends with turn.done', async () => {
    const session = await newSession(spec(LIVE));
    const events = await streamTurn(session, userMessage('Say hello'));
    assert(events[0]?.type === 'turn.created', `First event was ${events[0]?.type}`);
    const deltas = events.filter(event => event.type === 'model.message.delta').length;
    assert(deltas > 1, `Expected several deltas, saw ${deltas}`);
    assert(terminal(events)?.status === 'done', `Terminal state: ${JSON.stringify(terminal(events))}`);
    return `${deltas} deltas`;
  });

  let approvedSession;
  let approvedCall;
  await check('a tool gated by name pauses the turn before anything runs (no annotation needed)', async () => {
    mcpCalls.length = 0;
    approvedSession = await newSession(spec(LIVE));
    const events = await streamTurn(approvedSession, userMessage('SMOKE_TOOL'));
    approvedCall = await pendingCall(approvedSession, events);
    assert(mcpCalls.length === 0, 'The tool ran before approval');
    assert(approvedCall.call.tool_info?.name === 'smoke_write', `tool_info: ${JSON.stringify(approvedCall.call.tool_info)}`);
    return `paused, function name sent to model: ${approvedCall.call.function.name}`;
  });

  await check('allow resumes the turn, and the MCP server receives the arguments unchanged', async () => {
    const decision = [{ type: 'user.tool_approval', thread_id: approvedCall.threadId, tool_call_id: approvedCall.call.id, approval: { status: 'allow' } }];
    const events = await streamTurn(approvedSession, decision);
    assert(events.some(event => event.type === 'tool.response'), 'No tool.response');
    assert(terminal(events)?.status === 'done', `Terminal state: ${JSON.stringify(terminal(events))}`);
    assert(mcpCalls.length === 1, `MCP calls: ${mcpCalls.length}`);
    const expected = JSON.stringify(JSON.parse(approvedCall.call.function.arguments));
    assert(JSON.stringify(mcpCalls[0].args) === expected, `Reviewed ${expected} but the tool received ${JSON.stringify(mcpCalls[0].args)}`);
  });

  await check('deny keeps the tool from running, and the agent carries on', async () => {
    mcpCalls.length = 0;
    const session = await newSession(spec(LIVE));
    const { threadId, call } = await pendingCall(session, await streamTurn(session, userMessage('SMOKE_TOOL')));
    const events = await streamTurn(session, [{ type: 'user.tool_approval', thread_id: threadId, tool_call_id: call.id, approval: { status: 'deny', reason: 'rejected in review' } }]);
    assert(mcpCalls.length === 0, 'The tool ran after deny');
    assert(terminal(events)?.status === 'done', `Terminal state: ${JSON.stringify(terminal(events))}`);
  });

  await check('a deferred tool still pauses, wrapped in call_tool with the arguments under input', async () => {
    mcpCalls.length = 0;
    const session = await newSession(spec(LIVE, { preload: false }));
    const events = await streamTurn(session, userMessage('SMOKE_DEFERRED'));
    const { threadId, call } = await pendingCall(session, events);
    const args = JSON.parse(call.function.arguments);
    assert(args.tool_name === 'smoke_write' && args.input?.path === 'b.txt', `Arguments: ${call.function.arguments}`);
    assert(mcpCalls.length === 0, 'The deferred tool ran before approval');
    await streamTurn(session, [{ type: 'user.tool_approval', thread_id: threadId, tool_call_id: call.id, approval: { status: 'allow' } }]);
    assert(JSON.stringify(mcpCalls[0]?.args) === JSON.stringify(args.input), `The tool received ${JSON.stringify(mcpCalls[0]?.args)}`);
    return `function ${call.function.name}, tool_info ${call.tool_info?.name}`;
  });

  await check('cancel ends a running turn as cancelled', async () => {
    const session = await newSession(spec(LIVE));
    let asked = 0;
    const events = await streamTurn(session, userMessage('SMOKE_SLOW'), async event => {
      if (event.type === 'model.message.delta' && asked === 0) {
        asked = performance.now();
        await must('POST', `/api/v1/sessions/${session}/cancel`, {});
      }
    });
    assert(asked > 0, 'No token arrived to cancel after');
    const state = terminal(events);
    assert(state?.status === 'cancelled', `Terminal state: ${JSON.stringify(state)}`);
    return `reason ${state.reason}, stream closed ${Math.round(performance.now() - asked)} ms after the request`;
  });

  await check('an unreachable model ends the turn with status error, not a hang (Task C)', async () => {
    const started = performance.now();
    const session = await newSession(spec(DEAD));
    const state = terminal(await streamTurn(session, userMessage('Say hello')));
    assert(state?.status === 'error', `Terminal state: ${JSON.stringify(state)}`);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    notes.push(`Message for an unreachable model after ${seconds}s: ${state.message}`);
    return `${seconds}s`;
  });

  await check('an invalid key ends the turn with status error (Task C)', async () => {
    const session = await newSession(spec(BAD_KEY));
    const state = terminal(await streamTurn(session, userMessage('Say hello')));
    assert(state?.status === 'error', `Terminal state: ${JSON.stringify(state)}`);
    notes.push(`Message for an invalid key: ${state.message}`);
  });

  await check('fallback: PATCH swaps the model on an inline session, and the next turn succeeds', async () => {
    const session = await newSession(spec(DEAD));
    const failed = terminal(await streamTurn(session, userMessage('Say hello')));
    assert(failed?.status === 'error', `First turn: ${JSON.stringify(failed)}`);
    await must('PATCH', `/api/v1/sessions/${session}`, { agent: { spec: spec(LIVE) } });
    const events = await streamTurn(session, userMessage('Say hello'));
    assert(terminal(events)?.status === 'done', `After the switch: ${JSON.stringify(terminal(events))}`);
    assert(events.some(event => event.type === 'model.message.delta'), 'No tokens after the switch');
  });
} catch (error) {
  console.error(error.message);
} finally {
  for (const path of ['model-providers/smoke-live', 'model-providers/smoke-dead', 'model-providers/smoke-badkey', `mcp-servers/${MCP_NAME}`]) {
    await api('DELETE', `/api/v1/settings/${path}`).catch(() => undefined);
  }
  mcp.close();
  await mock.close();
}

const failures = results.filter(result => !result.ok).length;
console.log(`\n${results.length - failures} passed, ${failures} failed against ${BASE}`);
for (const note of notes) {
  console.log(`Note: ${note}`);
}

if (process.argv.includes('--write')) {
  const rows = results.map(result => `| ${result.ok ? 'Pass' : 'FAIL'} | ${result.name} | ${result.detail.replaceAll('|', '\\|').replaceAll('\n', ' ')} |`);
  writeFileSync(
    'docs/research/smoke-results.md',
    [
      '# TrueForge smoke results',
      '',
      `Generated by \`npm run smoke -- --write\` on ${new Date().toISOString().slice(0, 10)}, against TrueForge ${health.version ?? '(version not reported)'}.`,
      '',
      '| Result | Check | Detail |',
      '| --- | --- | --- |',
      ...rows,
      '',
      ...notes.map(note => `- ${note}`),
      '',
    ].join('\n'),
  );
  console.log('Wrote docs/research/smoke-results.md');
}
process.exit(failures === 0 && results.length > 0 ? 0 : 1);
