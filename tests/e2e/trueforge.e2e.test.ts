import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import coder from '../../agent/definitions/coder.json';
import inlineEdit from '../../agent/definitions/inline-edit.json';
// @ts-expect-error The mock model is plain JavaScript so it can run with no build step.
import { startMockModel } from '../../examples/mock-model/mock-model.mjs';
import { type AgentDefinition, AgentDefinitionSchema } from '../../extension/src/core/agentDefinition';
import { AgentRun, type RunEvent, type RunResult } from '../../extension/src/core/agentRun';
import { ApprovalGate } from '../../extension/src/core/approvalGate';
import { CommandRunner } from '../../extension/src/core/commandRunner';
import type { ReviewSession } from '../../extension/src/core/hunks';
import { EditJournal } from '../../extension/src/core/journal';
import { ReviewCoordinator, type ReviewUi } from '../../extension/src/core/review';
import { type RunningMcpServer, startMcpServer } from '../../extension/src/mcp/server';
import { createTools } from '../../extension/src/mcp/tools';
import { TrueForgeGateway } from '../../extension/src/trueforge/gateway';
import { createClient } from '../../extension/src/trueforge/setup';
import { MemoryWorkspace } from '../helpers/memoryWorkspace';

/**
 * The extension's real code against a real TrueForge: SDK gateway, run, review, MCP server, approval
 * gate and journal. Only the editor UI and the model are stand-ins. Run with `npm run test:e2e`
 * while `npm run trueforge` is up.
 */
const ENABLED = process.env['SYNAPSE_E2E'] === '1';
const BASE = process.env['TRUEFORGE_BASE_URL'] ?? 'http://localhost:8790';
// Its own MCP server name, so running this cannot break the registration of a running editor.
const MCP_NAME = 'synapse-e2e';
const LIVE = 'e2e-live/mock';
const DEAD = 'e2e-dead/mock';

const FIXTURE = {
  'src/greeter.py': 'def greet(name):\n    """Return a greeting."""\n    return "Hello, " + name\n',
  'tests/test_greeter.py': 'from greeter import greet\n\n\ndef test_greet():\n    assert greet("Ada") == "Hello, Ada"\n',
  'README.md': '# Greeter\n\nSays hello.\n',
};

function forE2e(definition: unknown): AgentDefinition {
  const parsed = AgentDefinitionSchema.parse(definition);
  return { ...parsed, mcp_servers: parsed.mcp_servers.map(server => ({ ...server, name: MCP_NAME })) };
}

interface Harness {
  ws: MemoryWorkspace;
  events: RunEvent[];
  reviewed: ReviewSession[];
  commands: string[];
  run: AgentRun;
  start: (prompt: string) => Promise<RunResult>;
}

describe.skipIf(!ENABLED)('extension code against a live TrueForge', () => {
  const client = createClient(BASE);
  let mock: { baseUrl: string; close(): Promise<void> };
  let mcp: RunningMcpServer;
  let scratch: string;
  // The MCP server is shared, like the extension's; each test points it at its own run.
  let current: { ws: MemoryWorkspace; gate: ApprovalGate; journal: EditJournal; runId: string };
  const runner = new CommandRunner();

  beforeAll(async () => {
    const health = await fetch(new URL('/healthz', BASE)).catch(() => undefined);
    if (!health?.ok) {
      throw new Error(`TrueForge is not reachable at ${BASE}. Start it with: npm run trueforge`);
    }
    scratch = mkdtempSync(join(tmpdir(), 'synapse-e2e-'));
    mock = (await startMockModel()) as typeof mock;
    mcp = await startMcpServer(
      createTools({
        ws: {
          root: '/workspace',
          read: path => current.ws.read(path),
          write: (path, text) => current.ws.write(path, text),
          remove: path => current.ws.remove(path),
          listFiles: () => current.ws.listFiles(),
          findSymbols: name => current.ws.findSymbols(name),
        },
        gate: { record: (key, approval) => current.gate.record(key, approval), consume: key => current.gate.consume(key) } as ApprovalGate,
        journal: {
          apply: (runId: string, path: string, after: string) => current.journal.apply(runId, path, after),
        } as EditJournal,
        runId: () => current.runId,
        runCommand: command => runner.run(command, { cwd: scratch, timeoutMs: 10_000 }),
      }),
    );
    const models = [{ name: 'mock', modelId: 'mock', properties: { contextLength: 100_000, maxOutputTokens: 4096 } }];
    await client.settings.modelProviders.createOrUpdate({ manifest: { type: 'custom', name: 'e2e-live', baseUrl: mock.baseUrl, auth: { apiKey: 'not-a-real-key' }, models } });
    await client.settings.modelProviders.createOrUpdate({ manifest: { type: 'custom', name: 'e2e-dead', baseUrl: 'http://127.0.0.1:19999/v1', auth: { apiKey: 'not-a-real-key' }, models } });
    await client.settings.mcpServers.createOrUpdate({
      manifest: { type: 'remote', name: MCP_NAME, url: mcp.url, description: 'End-to-end test workspace', auth: { type: 'header', headers: { Authorization: `Bearer ${mcp.token}` } } },
    });
  });

  afterAll(async () => {
    await client.settings.mcpServers.delete(MCP_NAME).catch(() => undefined);
    await client.settings.modelProviders.delete('e2e-live').catch(() => undefined);
    await client.settings.modelProviders.delete('e2e-dead').catch(() => undefined);
    await mcp?.close();
    await mock?.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  function harness(definition: AgentDefinition, models: string[], decide: (session: ReviewSession) => 'accepted' | 'rejected' = () => 'accepted'): Harness {
    const ws = new MemoryWorkspace(FIXTURE);
    const gate = new ApprovalGate();
    const journal = new EditJournal(ws);
    const runId = `run-${String(Math.random()).slice(2)}`;
    current = { ws, gate, journal, runId };
    const events: RunEvent[] = [];
    const reviewed: ReviewSession[] = [];
    const commands: string[] = [];
    const ui: ReviewUi = {
      reviewHunks: session => {
        reviewed.push(session);
        session.decideRemaining(decide(session));
        return Promise.resolve(true);
      },
      confirmCommand: command => {
        commands.push(command);
        return Promise.resolve(true);
      },
      closeAll: () => undefined,
    };
    const run = new AgentRun({
      runId,
      gateway: new TrueForgeGateway(client.sessions, definition),
      review: new ReviewCoordinator({ root: ws.root, files: ws, gate, ui }),
      closeReviews: () => undefined,
      abortCommands: () => {
        runner.abortAll();
      },
      journal,
      gate,
      fallback: { models, attemptsPerModel: 1, backoffMs: 0 },
      onEvent: event => events.push(event),
    });
    return { ws, events, reviewed, commands, run, start: prompt => run.start(prompt) };
  }

  const types = (events: RunEvent[]) => events.map(event => event.type);

  it('inline edit: streams, pauses for review, then applies the reviewed change through MCP (Task A path)', async () => {
    const h = harness(forE2e(inlineEdit), [LIVE]);
    const selected = 'def greet(name):\n    """Return a greeting."""\n    return "Hello, " + name';
    const result = await h.start(`<task>\nAdd a comment\n</task>\n\n<selection path="src/greeter.py" lines="1-3">\n${selected}\n</selection>`);
    expect(result).toMatchObject({ status: 'done', changedPaths: ['src/greeter.py'] });
    expect(h.reviewed).toHaveLength(1);
    expect(h.ws.files.get('src/greeter.py')).toBe(`${selected}\n# Edited by the mock model\n`);
    expect(types(h.events)).toContain('token');
    expect(h.events.filter(event => event.type === 'status').map(event => (event.type === 'status' ? event.status : ''))).toEqual(['running', 'reviewing', 'running', 'done']);
  });

  it('agent mode: retrieves, reads, reviews three files including parallel calls, runs a command (Task B path)', async () => {
    const h = harness(forE2e(coder), [LIVE]);
    const result = await h.start(`<task>\nE2E_AGENT server=${MCP_NAME}\n</task>`);
    expect(result.status).toBe('done');
    expect(result.status === 'done' ? result.changedPaths.sort() : []).toEqual(['docs/greeting.md', 'src/greeter.py', 'tests/test_greeter.py']);
    expect(h.ws.files.get('src/greeter.py')).toContain('return f"Hello, {name}!"');
    expect(h.ws.files.get('tests/test_greeter.py')).toContain('"Hello, Ada!"');
    expect(h.ws.files.get('docs/greeting.md')).toContain('# Greeting');
    expect(h.reviewed.map(session => session.path)).toEqual(['src/greeter.py', 'tests/test_greeter.py', 'docs/greeting.md']);
    expect(h.commands).toEqual(['echo tests-pass']);
    const calls = h.events.filter(event => event.type === 'tool-call').map(event => (event.type === 'tool-call' ? event.call.name : ''));
    expect(calls).toEqual(['retrieve_context', 'read_file', 'propose_edit', 'propose_edit', 'create_file', 'run_command']);
    const results = h.events.filter(event => event.type === 'tool-result').map(event => (event.type === 'tool-result' ? event.content : ''));
    expect(results.some(text => text.includes('tests-pass'))).toBe(true);
    expect(results.some(text => text.includes('Applied 1 of 1 hunks to src/greeter.py'))).toBe(true);
  });

  it('a rejected proposal is denied, so nothing is written and the agent is told', async () => {
    const h = harness(forE2e(inlineEdit), [LIVE], () => 'rejected');
    const before = h.ws.snapshot();
    const result = await h.start('<task>\nx\n</task>\n\n<selection path="README.md" lines="1-1">\n# Greeter\n</selection>');
    expect(result.status).toBe('done');
    expect(h.ws.snapshot()).toEqual(before);
    expect(h.ws.writes).toEqual([]);
  });

  it('cancel mid-stream restores a file already changed in the run, and the turn ends cancelled (A3)', async () => {
    const h = harness(forE2e(coder), [LIVE]);
    const before = h.ws.snapshot();
    let cancelledAt = 0;
    const started = h.start(`<task>\nE2E_SLOW server=${MCP_NAME}\n</task>`);
    for (let waited = 0; waited < 10_000 && cancelledAt === 0; waited += 20) {
      // Cancel once the edit is on disk and the slow reply has begun streaming.
      if (h.ws.files.get('src/greeter.py')?.includes('Hi, ') && h.events.filter(event => event.type === 'token').length > 2) {
        cancelledAt = performance.now();
        await h.run.cancel();
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const result = await started;
    expect(cancelledAt).toBeGreaterThan(0);
    expect(result.status).toBe('cancelled');
    expect(performance.now() - cancelledAt).toBeLessThan(2000);
    expect(h.ws.snapshot()).toEqual(before);
  });

  it('falls back to the second model when the first is unreachable, with no user action (Task C, B3)', async () => {
    const h = harness(forE2e(inlineEdit), [DEAD, LIVE]);
    const started = performance.now();
    const result = await h.start('<task>\nx\n</task>\n\n<selection path="README.md" lines="1-1">\n# Greeter\n</selection>');
    expect(result.status).toBe('done');
    expect(h.events).toContainEqual(expect.objectContaining({ type: 'model-switch', from: DEAD, to: LIVE }));
    expect(performance.now() - started).toBeLessThan(15_000);
  });

  it('fails clearly, leaving the workspace unchanged, when every model is down (Task C, B3)', async () => {
    const h = harness(forE2e(inlineEdit), [DEAD]);
    const before = h.ws.snapshot();
    const result = await h.start('<task>\nx\n</task>\n\n<selection path="README.md" lines="1-1">\n# Greeter\n</selection>');
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' ? result.message : '').toMatch(/Model Error/);
    expect(h.ws.snapshot()).toEqual(before);
  });

  it('reports a deferred tool as loaded on demand, under its real name', async () => {
    const h = harness(forE2e(coder), [LIVE]);
    expect((await h.start(`<task>\nE2E_DEFERRED server=${MCP_NAME}\n</task>`)).status).toBe('done');
    const call = h.events.find(event => event.type === 'tool-call');
    expect(call).toMatchObject({ type: 'tool-call', deferred: true, call: { name: 'find_symbol', args: { name: 'greet' } } });
    expect(h.events.some(event => event.type === 'tool-result' && event.content.includes('src/greeter.py:1'))).toBe(true);
  });
});
