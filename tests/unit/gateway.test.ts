import { describe, expect, it } from 'vitest';
import coder from '../../agent/definitions/coder.json';
import { AgentDefinitionSchema, toSdkSpec } from '../../extension/src/core/agentDefinition';
import type { GatewayEvent } from '../../extension/src/core/agentRun';
import { TrueForgeGateway } from '../../extension/src/trueforge/gateway';

const definition = AgentDefinitionSchema.parse(coder);

/** Events are written in the SDK's camelCase shape, as its deserialised stream yields them. */
function fakeSessions(events: object[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const sessions = {
    create: (...args: unknown[]) => {
      calls.push({ method: 'create', args });
      return Promise.resolve({ data: { id: 'session-1' } });
    },
    update: (...args: unknown[]) => {
      calls.push({ method: 'update', args });
      return Promise.resolve({ data: { id: 'session-1' } });
    },
    cancel: (...args: unknown[]) => {
      calls.push({ method: 'cancel', args });
      return Promise.resolve({});
    },
    createTurnStream: (...args: unknown[]) => {
      calls.push({ method: 'createTurnStream', args });
      return Promise.resolve({
        withMetadata: async function* () {
          for (const [index, data] of events.entries()) {
            yield { data, id: String(index) };
          }
        },
      });
    },
  };
  return { sessions: sessions as unknown as ConstructorParameters<typeof TrueForgeGateway>[0], calls };
}

async function collect(events: object[], input: Parameters<TrueForgeGateway['streamTurn']>[1] = { kind: 'message', text: 'hi' }) {
  const fake = fakeSessions(events);
  const output: GatewayEvent[] = [];
  for await (const event of new TrueForgeGateway(fake.sessions, definition).streamTurn('session-1', input, new AbortController().signal)) {
    output.push(event);
  }
  return { output, calls: fake.calls };
}

const base = (extra: object) => ({ type: 'model.message', id: 'm1', threadId: 'main', createdAt: 't', content: '', ...extra });
const delta = (extra: object) => ({ type: 'model.message.delta', id: 'm1', threadId: 'main', createdAt: 't', ...extra });
const toolInfo = { type: 'mcp', name: 'propose_edit', serverId: 's', serverName: 'synapse-editor' };

describe('TrueForgeGateway', () => {
  it('streams tokens as they arrive', async () => {
    const { output } = await collect([
      { type: 'turn.created', turnId: 'turn-1', threadId: null, id: 'e', createdAt: 't' },
      base({}),
      delta({ content: 'Hel' }),
      delta({ content: 'lo' }),
      { type: 'turn.done', id: 'd', threadId: null, createdAt: 't', state: { status: 'done', output: { content: 'Hello' }, requiredActions: [], completedAt: 't' } },
    ]);
    expect(output.filter(event => event.type === 'token').map(event => (event.type === 'token' ? event.text : ''))).toEqual(['Hel', 'lo']);
    expect(output.at(-1)).toEqual({ type: 'turn-done', outcome: { status: 'done', output: 'Hello' } });
  });

  it('reassembles tool arguments from fragments before reporting an approval', async () => {
    const args = { path: 'a.py', edits: [{ old_text: 'x', new_text: 'y' }], rationale: 'r' };
    const text = JSON.stringify(args);
    const { output } = await collect([
      base({ toolCalls: [{ id: 'call-1', type: 'function', index: 0, function: { name: 'propose_edit', arguments: '' }, toolInfo }] }),
      delta({ toolCalls: [{ index: 0, function: { arguments: text.slice(0, 10) } }] }),
      delta({ toolCalls: [{ index: 0, function: { arguments: text.slice(10) } }], finishReason: 'tool_calls' }),
      { type: 'tool.approval_required', id: 'a', threadId: 'main', createdAt: 't', toolCalls: [{ id: 'call-1', sourceEventId: 'm1' }] },
      {
        type: 'turn.done',
        id: 'd',
        threadId: null,
        createdAt: 't',
        state: { status: 'done', output: null, completedAt: 't', requiredActions: [{ type: 'tool.approval_required', threadId: 'main', toolCalls: [{ id: 'call-1', sourceEventId: 'm1' }] }] },
      },
    ]);
    expect(output).toContainEqual({
      type: 'approval-required',
      pending: [{ threadId: 'main', call: { id: 'call-1', name: 'propose_edit', args } }],
    });
    expect(output.at(-1)).toEqual({ type: 'turn-done', outcome: { status: 'done', output: '' } });
  });

  it('unwraps a deferred tool call in an approval', async () => {
    const inner = { path: 'a.py', edits: [{ old_text: 'x', new_text: 'y' }], rationale: 'r' };
    const { output } = await collect([
      base({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'call_tool', arguments: JSON.stringify({ mcp_server: 'synapse-editor', tool_name: 'propose_edit', input: inner }) },
            toolInfo,
          },
        ],
      }),
      { type: 'tool.approval_required', id: 'a', threadId: 'main', createdAt: 't', toolCalls: [{ id: 'call-1', sourceEventId: 'm1' }] },
      { type: 'turn.done', id: 'd', threadId: null, createdAt: 't', state: { status: 'done', output: null, requiredActions: [], completedAt: 't' } },
    ]);
    expect(output).toContainEqual({ type: 'approval-required', pending: [{ threadId: 'main', call: { id: 'call-1', name: 'propose_edit', args: inner } }] });
    expect(output).toContainEqual({ type: 'tool-call', threadId: 'main', deferred: true, call: { id: 'call-1', name: 'propose_edit', args: inner } });
  });

  it('flags an approval it cannot match, so it is denied rather than guessed at', async () => {
    const { output } = await collect([
      { type: 'tool.approval_required', id: 'a', threadId: 'main', createdAt: 't', toolCalls: [{ id: 'ghost', sourceEventId: 'nope' }] },
      { type: 'turn.done', id: 'd', threadId: null, createdAt: 't', state: { status: 'done', output: null, requiredActions: [], completedAt: 't' } },
    ]);
    const pending = output.find(event => event.type === 'approval-required');
    expect(pending?.type === 'approval-required' ? pending.pending[0]?.call.parseError : undefined).toBeDefined();
  });

  it('maps cancelled and error outcomes', async () => {
    const done = (state: object) => [{ type: 'turn.done', id: 'd', threadId: null, createdAt: 't', state }];
    expect((await collect(done({ status: 'cancelled', reason: 'client-cancelled', completedAt: 't' }))).output.at(-1)).toEqual({
      type: 'turn-done',
      outcome: { status: 'cancelled', reason: 'client-cancelled' },
    });
    expect((await collect(done({ status: 'error', message: 'model exploded', completedAt: 't' }))).output.at(-1)).toEqual({
      type: 'turn-done',
      outcome: { status: 'error', message: 'model exploded' },
    });
  });

  it('turns an unhandled pause into an error rather than a silent stop', async () => {
    const { output } = await collect([
      {
        type: 'turn.done',
        id: 'd',
        threadId: null,
        createdAt: 't',
        state: { status: 'done', output: null, completedAt: 't', requiredActions: [{ type: 'tool.response_required', threadId: 'main', toolCalls: [] }] },
      },
    ]);
    expect(output.at(-1)).toMatchObject({ outcome: { status: 'error', message: expect.stringMatching(/tool\.response_required/) as string } });
  });

  it('reports subagents, tool results and compaction', async () => {
    const { output } = await collect([
      { type: 'thread.created', id: 'e', threadId: 'sub-1', title: 'explore', createdAt: 't' },
      { type: 'tool.response', id: 'e', threadId: 'sub-1', toolCallId: 'c', content: 'data', createdAt: 't' },
      { type: 'thread.context_compaction_started', id: 'e', threadId: 'main', createdAt: 't' },
      { type: 'thread.done', id: 'e', threadId: 'sub-1', title: 'explore', state: { status: 'error', error: 'boom' }, createdAt: 't' },
      { type: 'turn.done', id: 'd', threadId: null, createdAt: 't', state: { status: 'done', output: null, requiredActions: [], completedAt: 't' } },
    ]);
    expect(output).toContainEqual({ type: 'thread-started', threadId: 'sub-1', title: 'explore' });
    expect(output).toContainEqual({ type: 'tool-result', threadId: 'sub-1', toolCallId: 'c', content: 'data' });
    expect(output).toContainEqual({ type: 'compaction', threadId: 'main', phase: 'started' });
    expect(output).toContainEqual({ type: 'thread-finished', threadId: 'sub-1', title: 'explore', error: 'boom' });
  });

  it('sends approvals in the shape the harness expects', async () => {
    const { calls } = await collect([{ type: 'turn.done', id: 'd', threadId: null, createdAt: 't', state: { status: 'done', output: null, requiredActions: [], completedAt: 't' } }], {
      kind: 'approvals',
      decisions: [
        { threadId: 'main', toolCallId: 'a', decision: { status: 'allow' } },
        { threadId: 'sub', toolCallId: 'b', decision: { status: 'deny', reason: 'no' } },
      ],
    });
    expect(calls[0]?.args[1]).toEqual({
      input: [
        { type: 'user.tool_approval', threadId: 'main', toolCallId: 'a', approval: { status: 'allow' } },
        { type: 'user.tool_approval', threadId: 'sub', toolCallId: 'b', approval: { status: 'deny', reason: 'no' } },
      ],
    });
  });

  it('creates inline sessions, because only those can change model later', async () => {
    const fake = fakeSessions([]);
    const gateway = new TrueForgeGateway(fake.sessions, definition);
    await gateway.createSession('p/one');
    await gateway.switchModel('session-1', 'p/two');
    expect(fake.calls[0]?.args[0]).toMatchObject({ agent: { spec: { model: { name: 'p/one' } } } });
    expect(fake.calls[1]?.args).toMatchObject(['session-1', { agent: { spec: { model: { name: 'p/two' } } } }]);
  });
});

describe('agent definitions', () => {
  it('gates every writing tool by name, since unlabelled tools skip @write approval', () => {
    const spec = toSdkSpec(definition, 'p/m');
    expect(spec.mcpServers[0]?.requireApprovalForTools).toEqual(['propose_edit', 'create_file', 'run_command']);
  });

  it('turns off the offload that would swallow results when there is no sandbox', () => {
    expect(toSdkSpec(definition, 'p/m').config.contextManagement.largeToolResponse).toEqual({ enabled: false });
  });

  it('rejects an unknown field rather than ignoring it', () => {
    expect(AgentDefinitionSchema.safeParse({ ...coder, modle: 'typo' }).success).toBe(false);
  });
});
