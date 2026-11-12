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

/** Decides the reply from the conversation alone, so the server holds no state between requests. */
export function decide({ messages = [], tools = [] }) {
  const lastUser = textOf([...messages].reverse().find(message => message.role === 'user')?.content);
  const toolAnswered = messages.at(-1)?.role === 'tool';
  if (toolAnswered) {
    return { text: 'Done. The tool returned its result.' };
  }
  if (lastUser.includes('SMOKE_SLOW')) {
    return { text: Array.from({ length: 200 }, (_, index) => `word${index} `), delayMs: 100 };
  }
  const direct = findTool(tools, 'smoke_write');
  if (lastUser.includes('SMOKE_TOOL') && direct) {
    return { toolCall: { name: direct.function.name, args: { path: 'a.txt', content: 'hello "world"\n' } } };
  }
  const meta = findTool(tools, 'call_tool');
  if (lastUser.includes('SMOKE_DEFERRED') && meta) {
    return {
      toolCall: {
        name: meta.function.name,
        args: { mcp_server: 'smoke-editor', tool_name: 'smoke_write', input: { path: 'b.txt', content: 'deferred\n' } },
      },
    };
  }
  // Lets the whole inline edit flow be tried with no model: appends a comment to the selection.
  const selection = /<selection path="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/selection>/.exec(lastUser);
  const propose = findTool(tools, 'propose_edit');
  if (selection && propose) {
    const [, path, selected] = selection;
    return {
      text: 'Proposing the edit.',
      toolCall: {
        name: propose.function.name,
        args: { path, edits: [{ old_text: selected, new_text: `${selected}\n# Edited by the mock model` }], rationale: 'Scripted edit from the mock model.' },
      },
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
  if (reply.toolCall) {
    const json = JSON.stringify(reply.toolCall.args);
    const middle = Math.floor(json.length / 2);
    // Sent in two fragments, like real providers, so clients must reassemble the arguments.
    send({ tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: reply.toolCall.name, arguments: json.slice(0, middle) } }] });
    send({ tool_calls: [{ index: 0, function: { arguments: json.slice(middle) } }] });
  }
  send({}, reply.toolCall ? 'tool_calls' : 'stop');
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
          finish_reason: reply.toolCall ? 'tool_calls' : 'stop',
          message: {
            role: 'assistant',
            content: text,
            ...(reply.toolCall
              ? { tool_calls: [{ id: `call_${Date.now()}`, type: 'function', function: { name: reply.toolCall.name, arguments: JSON.stringify(reply.toolCall.args) } }] }
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
