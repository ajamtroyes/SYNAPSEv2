import { describe, expect, it } from 'vitest';
import { AgentRun, type GatewayEvent, type RunEvent, type TurnGateway, type TurnInput } from '../../extension/src/core/agentRun';
import { ApprovalGate, approvalKey } from '../../extension/src/core/approvalGate';
import { EditJournal } from '../../extension/src/core/journal';
import { ReviewCoordinator, type ReviewUi } from '../../extension/src/core/review';
import { createTools } from '../../extension/src/mcp/tools';
import { MemoryWorkspace } from '../helpers/memoryWorkspace';

const editArgs = { path: 'a.py', edits: [{ old_text: 'old\n', new_text: 'new\n' }], rationale: 'because' };

const pendingEdit = (id: string, args: object = editArgs): GatewayEvent => ({
  type: 'approval-required',
  pending: [{ threadId: 'main', call: { id, name: 'propose_edit', args: args as Record<string, unknown> } }],
});
const done = (output = 'finished'): GatewayEvent => ({ type: 'turn-done', outcome: { status: 'done', output } });
const failed = (message: string): GatewayEvent => ({ type: 'turn-done', outcome: { status: 'error', message } });

type Script = (input: TurnInput, turn: number, model: string) => GatewayEvent[] | Promise<GatewayEvent[]>;

/** Plays scripted turns and records every interaction, so tests can assert on the protocol. */
class FakeGateway implements TurnGateway {
  readonly inputs: TurnInput[] = [];
  readonly models: string[] = [];
  readonly cancelled: string[] = [];
  private model = '';

  constructor(private readonly script: Script) {}

  createSession(model: string): Promise<string> {
    this.model = model;
    this.models.push(model);
    return Promise.resolve('session-1');
  }

  switchModel(_sessionId: string, model: string): Promise<void> {
    this.model = model;
    this.models.push(model);
    return Promise.resolve();
  }

  cancel(sessionId: string): Promise<void> {
    this.cancelled.push(sessionId);
    return Promise.resolve();
  }

  async *streamTurn(_sessionId: string, input: TurnInput, signal: AbortSignal): AsyncIterable<GatewayEvent> {
    this.inputs.push(input);
    for (const event of await this.script(input, this.inputs.length, this.model)) {
      if (signal.aborted) {
        throw new Error('aborted');
      }
      yield event;
    }
  }
}

function fakeUi(choose: (hunkIds: number[]) => Record<number, 'accepted' | 'rejected'> = ids => Object.fromEntries(ids.map(id => [id, 'accepted']))): ReviewUi {
  return {
    reviewHunks: session => {
      const decisions = choose(session.hunks.map(hunk => hunk.id));
      for (const [id, decision] of Object.entries(decisions)) {
        session.decide(Number(id), decision);
      }
      return Promise.resolve(true);
    },
    confirmCommand: () => Promise.resolve(true),
    closeAll: () => undefined,
  };
}

function setup(script: Script, options: { ui?: ReviewUi; models?: string[]; initial?: Record<string, string> } = {}) {
  const ws = new MemoryWorkspace(options.initial ?? { 'a.py': 'keep\nold\nkeep\n' });
  const gate = new ApprovalGate();
  const journal = new EditJournal(ws);
  const events: RunEvent[] = [];
  const gateway = new FakeGateway(script);
  const ui = options.ui ?? fakeUi();
  const run = new AgentRun({
    runId: 'run-1',
    gateway,
    review: new ReviewCoordinator({ root: ws.root, files: ws, gate, ui }),
    closeReviews: () => {
      ui.closeAll();
    },
    abortCommands: () => undefined,
    journal,
    gate,
    fallback: { models: options.models ?? ['a/one', 'b/two'], attemptsPerModel: 1, backoffMs: 0 },
    onEvent: event => events.push(event),
    sleep: () => Promise.resolve(),
  });
  const tools = createTools({ ws, gate, journal, runId: () => 'run-1', runCommand: () => Promise.resolve({ exitCode: 0, output: '', timedOut: false, aborted: false }) });
  const callTool = (name: string, args: unknown) => {
    const tool = tools.find(candidate => candidate.name === name);
    if (!tool) {
      throw new Error(`no tool ${name}`);
    }
    return tool.run(args as never, args);
  };
  return { ws, gate, journal, events, gateway, run, callTool };
}

describe('AgentRun', () => {
  it('forwards tokens and finishes', async () => {
    const { run, events, ws } = setup(() => [{ type: 'token', messageId: 'm', threadId: 'main', text: 'hello' }, done('hello')]);
    const result = await run.start('do it');
    expect(result).toEqual({ status: 'done', output: 'hello', changedPaths: [] });
    expect(events).toContainEqual({ type: 'token', messageId: 'm', threadId: 'main', text: 'hello' });
    expect(ws.writes).toEqual([]);
  });

  it('applies an edit only after review approves it, via the tool', async () => {
    const context = setup(async (_input, turn) => {
      if (turn === 1) {
        return [pendingEdit('call-1'), done('')];
      }
      expect(context.ws.writes).toEqual([]);
      const result = await context.callTool('propose_edit', editArgs);
      expect(result.isError).toBeUndefined();
      return [done('all good')];
    });
    const result = await context.run.start('do it');
    expect(result).toEqual({ status: 'done', output: 'all good', changedPaths: ['a.py'] });
    expect(context.ws.files.get('a.py')).toBe('keep\nnew\nkeep\n');
    expect(context.gateway.inputs[1]).toEqual({
      kind: 'approvals',
      decisions: [{ threadId: 'main', toolCallId: 'call-1', decision: { status: 'allow' } }],
    });
  });

  it('applies only the accepted hunks and tells the agent which were rejected', async () => {
    const args = { path: 'a.py', edits: [{ old_text: 'one\ntwo\nthree\nfour\nfive\n', new_text: 'ONE\ntwo\nthree\nfour\nFIVE\n' }], rationale: 'r' };
    let toolText = '';
    const context = setup(
      async (_input, turn) => {
        if (turn === 1) {
          return [pendingEdit('c', args), done('')];
        }
        toolText = (await context.callTool('propose_edit', args)).text;
        return [done()];
      },
      {
        initial: { 'a.py': 'one\ntwo\nthree\nfour\nfive\n' },
        ui: fakeUi(() => ({ 1: 'accepted', 2: 'rejected' })),
      },
    );
    await context.run.start('do it');
    expect(context.ws.files.get('a.py')).toBe('ONE\ntwo\nthree\nfour\nfive\n');
    expect(toolText).toMatch(/Applied 1 of 2 hunks/);
    expect(toolText).toMatch(/rejected hunks 2/);
  });

  it('denies with a reason when every hunk is rejected, and writes nothing', async () => {
    const context = setup((_input, turn) => (turn === 1 ? [pendingEdit('c'), done('')] : [done()]), {
      ui: fakeUi(ids => Object.fromEntries(ids.map(id => [id, 'rejected']))),
    });
    await context.run.start('do it');
    expect(context.gateway.inputs[1]).toMatchObject({
      decisions: [{ decision: { status: 'deny', reason: expect.stringMatching(/rejected every hunk/) as string } }],
    });
    expect(context.ws.writes).toEqual([]);
  });

  it('denies an edit to text that does not exist without showing it to the user', async () => {
    let shown = 0;
    const ui: ReviewUi = {
      reviewHunks: () => {
        shown += 1;
        return Promise.resolve(true);
      },
      confirmCommand: () => Promise.resolve(true),
      closeAll: () => undefined,
    };
    const args = { path: 'a.py', edits: [{ old_text: 'does_not_exist', new_text: 'x' }], rationale: 'r' };
    const context = setup((_input, turn) => (turn === 1 ? [pendingEdit('c', args), done('')] : [done()]), { ui });
    await context.run.start('do it');
    expect(shown).toBe(0);
    expect(context.gateway.inputs[1]).toMatchObject({
      decisions: [{ decision: { status: 'deny', reason: expect.stringMatching(/not found/) as string } }],
    });
  });

  it('answers every pending approval in a single resume, as the harness requires', async () => {
    const second = { path: 'b.py', edits: [{ old_text: 'b', new_text: 'B' }], rationale: 'r' };
    const context = setup(
      (_input, turn) =>
        turn === 1
          ? [
              {
                type: 'approval-required',
                pending: [
                  { threadId: 'main', call: { id: 'c1', name: 'propose_edit', args: editArgs } },
                  { threadId: 'sub-1', call: { id: 'c2', name: 'propose_edit', args: second } },
                ],
              },
              done(''),
            ]
          : [done()],
      { initial: { 'a.py': 'keep\nold\nkeep\n', 'b.py': 'b\n' } },
    );
    await context.run.start('do it');
    expect(context.gateway.inputs).toHaveLength(2);
    expect(context.gateway.inputs[1]).toMatchObject({
      decisions: [
        { threadId: 'main', toolCallId: 'c1' },
        { threadId: 'sub-1', toolCallId: 'c2' },
      ],
    });
  });

  it('switches to the fallback model on failure and resends the request', async () => {
    const context = setup((_input, _turn, model) => (model === 'a/one' ? [failed('connect ECONNREFUSED')] : [done('from fallback')]));
    const result = await context.run.start('the request');
    expect(result).toMatchObject({ status: 'done', output: 'from fallback' });
    expect(context.gateway.models).toEqual(['a/one', 'b/two']);
    expect(context.gateway.inputs).toEqual([
      { kind: 'message', text: 'the request' },
      { kind: 'message', text: 'the request' },
    ]);
    expect(context.events).toContainEqual({ type: 'model-switch', from: 'a/one', to: 'b/two', reason: 'connect ECONNREFUSED' });
  });

  it('tells the fallback model to continue when the first one already made progress', async () => {
    const context = setup((_input, _turn, model) =>
      model === 'a/one' ? [{ type: 'token', messageId: 'm', threadId: 'main', text: 'working' }, failed('overloaded')] : [done()],
    );
    await context.run.start('the request');
    const resend = context.gateway.inputs[1];
    expect(resend?.kind === 'message' ? resend.text : '').toMatch(/continue the task/);
  });

  it('treats a stream that throws as a model failure', async () => {
    const context = setup((_input, _turn, model) => {
      if (model === 'a/one') {
        throw new Error('socket hang up');
      }
      return [done('recovered')];
    });
    expect(await context.run.start('x')).toMatchObject({ status: 'done', output: 'recovered' });
  });

  it('reports a clear failure and leaves the workspace unchanged when every model fails (Task C)', async () => {
    const context = setup(() => [failed('401 invalid api key')]);
    const result = await context.run.start('x');
    expect(result).toMatchObject({ status: 'failed', message: '401 invalid api key' });
    expect(context.ws.writes).toEqual([]);
    expect(context.events).toContainEqual({ type: 'status', status: 'failed', detail: '401 invalid api key' });
  });

  it('restores files already changed when every model then fails', async () => {
    const context = setup(async (_input, turn) => {
      if (turn === 1) {
        return [pendingEdit('c'), done('')];
      }
      if (turn === 2) {
        await context.callTool('propose_edit', editArgs);
      }
      return [failed('overloaded')];
    });
    const before = context.ws.snapshot();
    expect((await context.run.start('x')).status).toBe('failed');
    expect(context.ws.snapshot()).toEqual(before);
  });

  it('leaves no half-applied edits when cancelled mid-stream', async () => {
    let cancelNow: () => void = () => undefined;
    const context = setup(async (_input, turn) => {
      if (turn === 1) {
        return [pendingEdit('c'), done('')];
      }
      await context.callTool('propose_edit', editArgs);
      expect(context.ws.files.get('a.py')).toContain('new');
      cancelNow();
      return [{ type: 'token', messageId: 'm', threadId: 'main', text: 'too late' }, done()];
    });
    const before = context.ws.snapshot();
    cancelNow = () => {
      void context.run.cancel();
    };
    const result = await context.run.start('x');
    expect(result.status).toBe('cancelled');
    expect(context.ws.snapshot()).toEqual(before);
    expect(context.gateway.cancelled).toEqual(['session-1']);
    expect(context.events).toContainEqual({ type: 'status', status: 'cancelled' });
  });

  it('refuses a tool call that arrives after cancel', async () => {
    const context = setup(async (_input, turn) => {
      if (turn === 1) {
        return [pendingEdit('c'), done('')];
      }
      await context.run.cancel();
      const late = await context.callTool('propose_edit', editArgs);
      expect(late.isError).toBe(true);
      return [done()];
    });
    const before = context.ws.snapshot();
    await context.run.start('x');
    expect(context.ws.snapshot()).toEqual(before);
    expect(context.ws.writes).toEqual([]);
  });

  it('abandons an open review on cancel', async () => {
    let closed = false;
    let finish: (value: boolean) => void = () => undefined;
    const ui: ReviewUi = {
      reviewHunks: () =>
        new Promise(resolve => {
          finish = resolve;
        }),
      confirmCommand: () => Promise.resolve(false),
      closeAll: () => {
        closed = true;
        finish(false);
      },
    };
    const context = setup(() => [pendingEdit('c'), done('')], { ui });
    const started = context.run.start('x');
    await new Promise(resolve => setTimeout(resolve, 5));
    await context.run.cancel();
    expect((await started).status).toBe('cancelled');
    expect(closed).toBe(true);
    expect(context.ws.writes).toEqual([]);
  });

  it('restores the workspace when the server ends the turn as cancelled', async () => {
    const context = setup(async (_input, turn) => {
      if (turn === 1) {
        return [pendingEdit('c'), done('')];
      }
      await context.callTool('propose_edit', editArgs);
      return [{ type: 'turn-done', outcome: { status: 'cancelled', reason: 'server-execution-timeout' } }];
    });
    const before = context.ws.snapshot();
    expect((await context.run.start('x')).status).toBe('cancelled');
    expect(context.ws.snapshot()).toEqual(before);
  });

  it('errors clearly if the stream ends with no terminal event, then falls back', async () => {
    const context = setup((_input, _turn, model) => (model === 'a/one' ? [] : [done('ok')]), { models: ['a/one'] });
    expect(await context.run.start('x')).toMatchObject({ status: 'failed', message: expect.stringMatching(/without a terminal event/) as string });
  });
});

describe('the no silent writes lock', () => {
  it('refuses a write with no review, even if the approval pause never fired', async () => {
    const context = setup(async () => {
      const result = await context.callTool('propose_edit', editArgs);
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/no matching approval/);
      return [done()];
    });
    await context.run.start('x');
    expect(context.ws.writes).toEqual([]);
  });

  it('refuses arguments that differ from what was reviewed', async () => {
    const tampered = { ...editArgs, edits: [{ old_text: 'keep', new_text: 'evil' }] };
    const context = setup(async (_input, turn) => {
      if (turn === 1) {
        return [pendingEdit('c'), done('')];
      }
      expect((await context.callTool('propose_edit', tampered)).isError).toBe(true);
      return [done()];
    });
    await context.run.start('x');
    expect(context.ws.writes).toEqual([]);
  });

  it('refuses when the file changed during review', async () => {
    const context = setup(async (_input, turn) => {
      if (turn === 1) {
        return [pendingEdit('c'), done('')];
      }
      context.ws.files.set('a.py', 'edited by the user meanwhile\n');
      const result = await context.callTool('propose_edit', editArgs);
      expect(result.text).toMatch(/changed after the review/);
      return [done()];
    });
    await context.run.start('x');
    expect(context.ws.files.get('a.py')).toBe('edited by the user meanwhile\n');
  });

  it('cannot replay an approval', async () => {
    const context = setup(async (_input, turn) => {
      if (turn === 1) {
        return [pendingEdit('c'), done('')];
      }
      await context.callTool('propose_edit', editArgs);
      context.ws.files.set('a.py', 'keep\nold\nkeep\n');
      expect((await context.callTool('propose_edit', editArgs)).isError).toBe(true);
      return [done()];
    });
    await context.run.start('x');
    expect(context.gate.consume(approvalKey('propose_edit', editArgs))).toBeUndefined();
  });

  it('only runs a command the user approved', async () => {
    const context = setup(async () => {
      const result = await context.callTool('run_command', { command: 'rm -rf /', rationale: 'r' });
      expect(result.isError).toBe(true);
      return [done()];
    });
    await context.run.start('x');
  });
});
