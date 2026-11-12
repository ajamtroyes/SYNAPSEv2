import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalGate, approvalKey } from '../../extension/src/core/approvalGate';
import { CommandRunner } from '../../extension/src/core/commandRunner';
import { EditJournal } from '../../extension/src/core/journal';
import { type RunningMcpServer, startMcpServer } from '../../extension/src/mcp/server';
import { createTools } from '../../extension/src/mcp/tools';
import { MemoryWorkspace } from '../helpers/memoryWorkspace';

/** Exercises the real HTTP server with the same MCP client library TrueForge uses. */
describe('MCP server', () => {
  let server: RunningMcpServer;
  let ws: MemoryWorkspace;
  let gate: ApprovalGate;
  let client: Client;
  let scratch: string;
  const commands = new CommandRunner();

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { text: content[0]?.text ?? '', isError: result.isError === true };
  };

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'synapse-test-'));
    ws = new MemoryWorkspace();
    gate = new ApprovalGate();
    const journal = new EditJournal(ws);
    server = await startMcpServer(
      createTools({
        ws,
        gate,
        journal,
        runId: () => 'run-1',
        runCommand: command => commands.run(command, { cwd: scratch, timeoutMs: 5000 }),
      }),
    );
  });

  afterAll(async () => {
    await server.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  beforeEach(async () => {
    ws.files.clear();
    ws.writes.length = 0;
    gate.openRun();
    client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${server.token}` } } }),
    );
  });

  afterEach(async () => {
    await client.close();
  });

  it('binds to loopback only', () => {
    expect(new URL(server.url).hostname).toBe('127.0.0.1');
  });

  it('lists all tools, labelling reads and writes', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(
      ['create_file', 'find_symbol', 'list_files', 'propose_edit', 'read_file', 'retrieve_context', 'run_command', 'search_workspace'].sort(),
    );
    for (const name of ['propose_edit', 'create_file', 'run_command']) {
      expect(tools.find(tool => tool.name === name)?.annotations?.readOnlyHint, name).toBe(false);
    }
    expect(tools.find(tool => tool.name === 'read_file')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find(tool => tool.name === 'propose_edit')?.inputSchema.type).toBe('object');
  });

  it('sends schemas any provider can accept', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema, tool.name).not.toHaveProperty('$schema');
    }
  });

  it('rejects a missing or wrong token', async () => {
    const post = (headers: Record<string, string>) =>
      fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: '{}' });
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: 'Bearer wrong' })).status).toBe(401);
  });

  it('rejects a foreign Host header, which is how a DNS rebinding page would arrive', async () => {
    const { request } = await import('node:http');
    const { port } = new URL(server.url);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request(
        { host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host: 'evil.example.com', authorization: `Bearer ${server.token}` } },
        response => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      outgoing.on('error', reject);
      outgoing.end('{}');
    });
    expect(status).toBe(403);
  });

  it('answers 404 elsewhere and 405 to GET, as a stateless server should', async () => {
    const headers = { authorization: `Bearer ${server.token}` };
    expect((await fetch(new URL('/other', server.url), { headers })).status).toBe(404);
    expect((await fetch(server.url, { headers })).status).toBe(405);
  });

  it('reads a file, with a line range and a note about its size', async () => {
    ws.files.set('a.py', 'one\ntwo\nthree\n');
    const result = await call('read_file', { path: 'a.py', start_line: 2, end_line: 3 });
    expect(result.text).toBe('[a.py lines 2-3 of 4]\ntwo\nthree');
  });

  it('caps a long read and says where to continue', async () => {
    ws.files.set('big.py', Array.from({ length: 5000 }, (_, index) => `line number ${String(index)}`).join('\n'));
    const { text } = await call('read_file', { path: 'big.py' });
    expect(text.length).toBeLessThan(21_000);
    expect(text).toMatch(/continue with start_line \d+/);
  });

  it('refuses secrets and paths outside the workspace, with a usable error', async () => {
    ws.files.set('.env', 'KEY=1');
    expect(await call('read_file', { path: '.env' })).toMatchObject({ isError: true, text: expect.stringMatching(/secrets/) as string });
    expect(await call('read_file', { path: '../../etc/passwd' })).toMatchObject({ isError: true, text: expect.stringMatching(/outside/) as string });
  });

  it('rejects invalid arguments clearly', async () => {
    expect(await call('read_file', { path: '' })).toMatchObject({ isError: true, text: expect.stringMatching(/Invalid arguments/) as string });
    expect(await call('read_file', { path: 'a', extra: 1 })).toMatchObject({ isError: true });
    expect(await call('no_such_tool', {})).toMatchObject({ isError: true, text: expect.stringMatching(/Unknown tool/) as string });
  });

  it('searches text, and refuses a regular expression that could hang the editor', async () => {
    ws.files.set('a.py', 'Needle here\nnothing\n');
    expect((await call('search_workspace', { query: 'needle' })).text).toBe('a.py:1: Needle here');
    expect((await call('search_workspace', { query: '^Need.*re$', is_regex: true })).text).toBe('a.py:1: Needle here');
    expect((await call('search_workspace', { query: 'absent' })).text).toMatch(/No matches/);
    expect(await call('search_workspace', { query: '(a+)+$', is_regex: true })).toMatchObject({ isError: true });
    expect(await call('search_workspace', { query: '(', is_regex: true })).toMatchObject({ isError: true });
  });

  it('does not leak secrets through search or listing filters', async () => {
    ws.files.set('.env', 'NEEDLE=secret');
    expect((await call('search_workspace', { query: 'NEEDLE' })).text).toMatch(/No matches/);
  });

  it('finds a symbol, and is honest when it does not exist', async () => {
    ws.files.set('a.py', 'def real_function():\n    pass\n');
    expect((await call('find_symbol', { name: 'real_function' })).text).toContain('a.py:1');
    expect((await call('find_symbol', { name: 'imaginary' })).text).toMatch(/may not exist/);
  });

  it('retrieves context through the same tool the agent uses', async () => {
    ws.files.set('billing.py', 'def charge_invoice():\n    pass\n');
    const { text } = await call('retrieve_context', { query: 'charge invoice', budget_tokens: 500 });
    expect(text).toContain('billing.py:1-');
    expect(text).toMatch(/of 500 tokens/);
  });

  it('writes nothing without approval, then applies exactly what review accepted', async () => {
    ws.files.set('a.py', 'old\n');
    const args = { path: 'a.py', edits: [{ old_text: 'old', new_text: 'new' }], rationale: 'r' };
    expect(await call('propose_edit', args)).toMatchObject({ isError: true });
    expect(ws.writes).toEqual([]);

    gate.record(approvalKey('propose_edit', args), { kind: 'change', path: 'a.py', before: 'old\n', after: 'new\n', accepted: [1], rejected: [], total: 1 });
    expect(await call('propose_edit', args)).toMatchObject({ isError: false, text: 'Applied 1 of 1 hunks to a.py.' });
    expect(ws.files.get('a.py')).toBe('new\n');
  });

  it('matches approvals by content, through a real JSON round trip', async () => {
    const reviewed = { rationale: 'r', path: 'n.py', content: 'x = "é\\n"\n' };
    gate.record(approvalKey('create_file', reviewed), { kind: 'change', path: 'n.py', before: undefined, after: reviewed.content, accepted: [1], rejected: [], total: 1 });
    const result = await call('create_file', { path: 'n.py', content: 'x = "é\\n"\n', rationale: 'r' });
    expect(result.isError).toBe(false);
    expect(ws.files.get('n.py')).toBe(reviewed.content);
  });

  it('runs an approved command and reports its exit code', async () => {
    const args = { command: 'echo hello && exit 3', rationale: 'r' };
    expect(await call('run_command', args)).toMatchObject({ isError: true, text: expect.stringMatching(/no matching approval/) as string });
    gate.record(approvalKey('run_command', args), { kind: 'command' });
    const result = await call('run_command', args);
    expect(result.isError).toBe(true);
    expect(result.text).toBe('[exit code 3]\nhello\n');
  });

  it('kills a running command on cancel, so cancel is not held up by the harness', async () => {
    const started = Date.now();
    const running = commands.run('sleep 30', { cwd: scratch });
    await new Promise(resolve => setTimeout(resolve, 100));
    commands.abortAll();
    const result = await running;
    expect(result.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stops a command at its timeout and clips long output', async () => {
    const result = await commands.run('sleep 30', { cwd: scratch, timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
    const long = await commands.run('yes abcdefgh | head -n 20000', { cwd: scratch, maxOutputChars: 1000 });
    expect(long.output.length).toBeLessThan(1200);
    expect(long.output).toMatch(/characters omitted/);
  });
});
