// A scripted OpenAI-compatible model. It needs no API key, costs nothing, and behaves the same every
// time, so the smoke test and UI work do not depend on a real provider. It decides nothing clever:
// judges score what the extension does on screen, and this makes those behaviours reproducible.
//
// Run standalone with: npm run mock-model
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 11500;

const textOf = content => (typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '');

function findTool(tools, name) {
  return tools?.find(tool => tool.function?.name === name || tool.function?.name?.endsWith(name));
}

/** Calls a tool directly when it is loaded, or through TrueForge's call_tool when it is deferred. */
function callFor(tools, name, args, server) {
  const direct = findTool(tools, name);
  if (direct) {
    return { name: direct.function.name, args };
  }
  const meta = findTool(tools, 'call_tool');
  return meta ? { name: meta.function.name, args: { mcp_server: server, tool_name: name, input: args } } : undefined;
}

const slowText = () => Array.from({ length: 200 }, (_, index) => `word${index} `);

/**
 * Multi-step agent runs over the end-to-end fixture repository. Each step is one assistant
 * message, chosen by how many the model has already sent since the request.
 */
const SCENARIOS = {
  E2E_AGENT: [
    { text: 'Looking for the greeting code. ', calls: [['retrieve_context', { query: 'greeting function', budget_tokens: 800 }]] },
    { calls: [['read_file', { path: 'src/greeter.py' }]] },
    {
      text: 'I chose src/greeter.py because it defines greet, tests/test_greeter.py because it covers it, and docs for the new behaviour. ',
      calls: [['propose_edit', { path: 'src/greeter.py', edits: [{ old_text: 'return "Hello, " + name', new_text: 'return f"Hello, {name}!"' }], rationale: 'Add an exclamation mark.' }]],
    },
    {
      calls: [
        ['propose_edit', { path: 'tests/test_greeter.py', edits: [{ old_text: '"Hello, Ada"', new_text: '"Hello, Ada!"' }], rationale: 'Update the expected greeting.' }],
        ['create_file', { path: 'docs/greeting.md', content: '# Greeting\n\n`greet(name)` returns `Hello, <name>!`.\n', rationale: 'Document the greeting.' }],
      ],
    },
    { calls: [['run_command', { command: 'echo tests-pass', rationale: 'Run the tests.' }]] },
    { text: 'Done: changed three files and the tests pass.' },
  ],
  E2E_SLOW: [
    { calls: [['propose_edit', { path: 'src/greeter.py', edits: [{ old_text: 'return "Hello, " + name', new_text: 'return "Hi, " + name' }], rationale: 'Shorter greeting.' }]] },
    { text: slowText(), delayMs: 100 },
  ],
  E2E_DEFERRED: [{ calls: [['find_symbol', { name: 'greet' }]] }, { text: 'Found it.' }],
};

function scenarioReply(messages, tools, lastUser) {
  const marker = Object.keys(SCENARIOS).find(name => lastUser.includes(name));
  if (!marker) {
    return undefined;
  }
  const server = /server=([a-z0-9-]+)/.exec(lastUser)?.[1] ?? 'synapse-editor';
  const start = messages.findLastIndex(message => message.role === 'user' && textOf(message.content).includes(marker));
  const step = SCENARIOS[marker][messages.slice(start + 1).filter(message => message.role === 'assistant').length];
  if (!step) {
    return { text: 'Scenario finished.' };
  }
  const toolCalls = (step.calls ?? []).map(([name, args]) => callFor(tools, name, args, server)).filter(Boolean);
  return { text: step.text, delayMs: step.delayMs, toolCalls };
}

/** Decides the reply from the conversation alone, so the server holds no state between requests. */
export function decide({ messages = [], tools = [] }) {
  const lastUser = textOf([...messages].reverse().find(message => message.role === 'user')?.content);
  const scripted = scenarioReply(messages, tools, lastUser);
  if (scripted) {
    return scripted;
  }
  if (messages.at(-1)?.role === 'tool') {
    return { text: 'Done. The tool returned its result.' };
  }
  if (lastUser.includes('SMOKE_SLOW')) {
    return { text: slowText(), delayMs: 100 };
  }
  const direct = findTool(tools, 'smoke_write');
  if (lastUser.includes('SMOKE_TOOL') && direct) {
    return { toolCalls: [{ name: direct.function.name, args: { path: 'a.txt', content: 'hello "world"\n' } }] };
  }
  const meta = findTool(tools, 'call_tool');
  if (lastUser.includes('SMOKE_DEFERRED') && meta) {
    return {
      toolCalls: [{ name: meta.function.name, args: { mcp_server: 'smoke-editor', tool_name: 'smoke_write', input: { path: 'b.txt', content: 'deferred\n' } } }],
    };
  }
  // Lets the whole inline edit flow be tried with no model: appends a comment to the selection.
  const selection = /<selection path="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/selection>/.exec(lastUser);
  const propose = findTool(tools, 'propose_edit');
  if (selection && propose) {
    const [, path, selected] = selection;
    return {
      text: 'Proposing the edit.',
      toolCalls: [
        {
          name: propose.function.name,
          args: { path, edits: [{ old_text: selected, new_text: `${selected}\n# Edited by the mock model` }], rationale: 'Scripted edit from the mock model.' },
        },
      ],
    };
  }
  return { text: 'Hello from the mock model. It streams this reply word by word and calls no tools.'.split(/(?<= )/) };
}

const sleep = (ms, signal) =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

async function streamReply(res, reply, model, signal) {
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const send = (delta, finishReason = null, extra = {}) => {
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finishReason }], ...extra })}\n\n`);
  };
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  send({ role: 'assistant', content: '' });
  for (const piece of [reply.text ?? []].flat()) {
    if (signal.aborted) {
      res.end();
      return;
    }
    send({ content: piece });
    if (reply.delayMs) {
      await sleep(reply.delayMs, signal);
    }
  }
  const calls = reply.toolCalls ?? [];
  for (const [index, call] of calls.entries()) {
    const json = JSON.stringify(call.args);
    const middle = Math.floor(json.length / 2);
    // Sent in two fragments, like real providers, so clients must reassemble the arguments.
    send({ tool_calls: [{ index, id: `call_${Date.now()}_${index}`, type: 'function', function: { name: call.name, arguments: json.slice(0, middle) } }] });
    send({ tool_calls: [{ index, function: { arguments: json.slice(middle) } }] });
  }
  send({}, calls.length > 0 ? 'tool_calls' : 'stop');
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function completeReply(res, reply, model) {
  const text = [reply.text ?? []].flat().join('');
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          finish_reason: reply.toolCalls?.length ? 'tool_calls' : 'stop',
          message: {
            role: 'assistant',
            content: text,
            ...(reply.toolCalls?.length
              ? {
                  tool_calls: reply.toolCalls.map((call, index) => ({
                    id: `call_${Date.now()}_${index}`,
                    type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                  })),
                }
              : {}),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
  );
}

/** Model id `mock-401` answers as a provider does to a bad key, for testing that failure path. */
export function startMockModel({ port = 0 } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    const abort = new AbortController();
    res.on('close', () => {
      abort.abort();
    });
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: `No route ${req.url}` } }));
        return;
      }
      const request = JSON.parse(body || '{}');
      requests.push(request);
      if (request.model === 'mock-401') {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }));
        return;
      }
      const reply = decide(request);
      if (request.stream) {
        void streamReply(res, reply, request.model, abort.signal);
      } else {
        completeReply(res, reply, request.model);
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        requests,
        close: () =>
          new Promise(done => {
            server.close(done);
            server.closeAllConnections();
          }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { baseUrl } = await startMockModel({ port: Number(process.env.MOCK_MODEL_PORT ?? DEFAULT_PORT) });
  console.log(`Mock model listening at ${baseUrl}. Register it with: npm run setup:models -- --config agent/models.mock.example.json`);
}
