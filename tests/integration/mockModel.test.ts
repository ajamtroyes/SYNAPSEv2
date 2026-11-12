import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error The mock model is plain JavaScript so it can run with no build step.
import { decide, startMockModel } from '../../examples/mock-model/mock-model.mjs';

interface Chunk {
  choices: { delta: { content?: string; tool_calls?: { function: { name?: string; arguments?: string } }[] }; finish_reason: string | null }[];
}

const tool = (name: string) => ({ type: 'function', function: { name, parameters: {} } });

/** TrueForge is the real client. These checks hold the mock to the format a provider must speak. */
describe('mock model', () => {
  let mock: { baseUrl: string; close(): Promise<void> };

  beforeAll(async () => {
    mock = (await startMockModel()) as typeof mock;
  });

  afterAll(async () => {
    await mock.close();
  });

  const post = (body: object) =>
    fetch(`${mock.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  async function readStream(response: Response): Promise<Chunk[]> {
    const frames = (await response.text()).split('\n\n').filter(frame => frame.startsWith('data: '));
    expect(frames.at(-1)).toBe('data: [DONE]');
    return frames.slice(0, -1).map(frame => JSON.parse(frame.slice(6)) as Chunk);
  }

  it('streams text as OpenAI-style chunks', async () => {
    const response = await post({ model: 'mock', stream: true, messages: [{ role: 'user', content: 'hi' }] });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const chunks = await readStream(response);
    const text = chunks.map(chunk => chunk.choices[0]?.delta.content ?? '').join('');
    expect(text).toContain('Hello from the mock model');
    expect(chunks.filter(chunk => (chunk.choices[0]?.delta.content ?? '') !== '').length).toBeGreaterThan(1);
    expect(chunks.some(chunk => chunk.choices[0]?.finish_reason === 'stop')).toBe(true);
  });

  it('sends tool arguments in fragments that reassemble to valid JSON', async () => {
    const response = await post({ model: 'mock', stream: true, messages: [{ role: 'user', content: 'SMOKE_TOOL' }], tools: [tool('smoke_write')] });
    const chunks = await readStream(response);
    const fragments = chunks.flatMap(chunk => chunk.choices[0]?.delta.tool_calls ?? []);
    expect(fragments).toHaveLength(2);
    expect(fragments[0]?.function.name).toBe('smoke_write');
    expect(JSON.parse(fragments.map(item => item.function.arguments).join(''))).toEqual({ path: 'a.txt', content: 'hello "world"\n' });
    expect(chunks.some(chunk => chunk.choices[0]?.finish_reason === 'tool_calls')).toBe(true);
  });

  it('answers without streaming when asked', async () => {
    const response = await post({ model: 'mock', messages: [{ role: 'user', content: 'hi' }] });
    const body = (await response.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0]?.message.content).toContain('Hello');
  });

  it('answers a bad key the way a provider does', async () => {
    expect((await post({ model: 'mock-401', messages: [] })).status).toBe(401);
  });

  it('wraps a deferred call in the shape the harness expects', () => {
    const reply = decide({ messages: [{ role: 'user', content: 'SMOKE_DEFERRED' }], tools: [tool('call_tool')] }) as { toolCall: { args: object } };
    expect(reply.toolCall.args).toEqual({ mcp_server: 'smoke-editor', tool_name: 'smoke_write', input: { path: 'b.txt', content: 'deferred\n' } });
  });

  it('proposes an edit for an inline selection, so that flow works with no real model', () => {
    const content = '<task>\nchange it\n</task>\n\n<selection path="a.py" lines="1-2">\ndef a():\n    pass\n</selection>';
    const reply = decide({ messages: [{ role: 'user', content }], tools: [tool('propose_edit')] }) as { toolCall: { name: string; args: { path: string; edits: { old_text: string }[] } } };
    expect(reply.toolCall.name).toBe('propose_edit');
    expect(reply.toolCall.args.path).toBe('a.py');
    expect(reply.toolCall.args.edits[0]?.old_text).toBe('def a():\n    pass');
  });

  it('stops calling tools once a tool has answered, so runs always end', () => {
    expect(decide({ messages: [{ role: 'user', content: 'SMOKE_TOOL' }, { role: 'tool', content: 'ok' }], tools: [tool('smoke_write')] })).toEqual({ text: 'Done. The tool returned its result.' });
  });
});
