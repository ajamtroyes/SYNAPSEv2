import { describe, expect, it } from 'vitest';
import { ApprovalGate, approvalKey } from '../../extension/src/core/approvalGate';
import { classifyFailure, FallbackPolicy } from '../../extension/src/core/fallback';
import { EditJournal } from '../../extension/src/core/journal';
import { isSensitivePath, toWorkspacePath, ToolInputError } from '../../extension/src/core/paths';
import { applyEdits } from '../../extension/src/core/proposals';
import { normalizeToolCall } from '../../extension/src/core/toolCalls';
import { MemoryWorkspace } from '../helpers/memoryWorkspace';

describe('EditJournal', () => {
  it('undoes the most recent change', async () => {
    const ws = new MemoryWorkspace({ 'a.txt': 'one' });
    const journal = new EditJournal(ws);
    await journal.apply('run', 'a.txt', 'two');
    await journal.apply('run', 'a.txt', 'three');
    expect((await journal.undoLast()).restored).toEqual(['a.txt']);
    expect(ws.files.get('a.txt')).toBe('two');
  });

  it('rolls a whole run back, removing files it created', async () => {
    const ws = new MemoryWorkspace({ 'a.txt': 'one', 'b.txt': 'one' });
    const journal = new EditJournal(ws);
    await journal.apply('run', 'a.txt', 'two');
    await journal.apply('run', 'a.txt', 'three');
    await journal.apply('run', 'b.txt', 'two');
    await journal.apply('run', 'new.txt', 'created');
    const report = await journal.rollbackRun('run');
    expect(report.conflicts).toEqual([]);
    expect(ws.snapshot()).toEqual({ 'a.txt': 'one', 'b.txt': 'one' });
  });

  it('only rolls back the named run', async () => {
    const ws = new MemoryWorkspace({ 'a.txt': 'one', 'b.txt': 'one' });
    const journal = new EditJournal(ws);
    await journal.apply('first', 'a.txt', 'two');
    await journal.apply('second', 'b.txt', 'two');
    await journal.rollbackRun('second');
    expect(ws.snapshot()).toEqual({ 'a.txt': 'two', 'b.txt': 'one' });
  });

  it('never overwrites a file the user changed after the agent', async () => {
    const ws = new MemoryWorkspace({ 'a.txt': 'one' });
    const journal = new EditJournal(ws);
    await journal.apply('run', 'a.txt', 'two');
    await journal.apply('run', 'a.txt', 'three');
    ws.files.set('a.txt', 'typed by the user');
    const report = await journal.rollbackRun('run');
    expect(report).toEqual({ restored: [], conflicts: ['a.txt'] });
    expect(ws.files.get('a.txt')).toBe('typed by the user');
  });

  it('can still undo when format-on-save changed what was written', async () => {
    const ws = new MemoryWorkspace({ 'a.txt': 'one\n' });
    ws.transformOnWrite = text => `${text.trimEnd()}\n`;
    const journal = new EditJournal(ws);
    await journal.apply('run', 'a.txt', 'two   ');
    expect(ws.files.get('a.txt')).toBe('two\n');
    expect((await journal.undoLast()).restored).toEqual(['a.txt']);
    expect(ws.files.get('a.txt')).toBe('one\n');
  });

  it('runs a rollback after a write already in flight', async () => {
    const ws = new MemoryWorkspace({ 'a.txt': 'one' });
    const journal = new EditJournal(ws);
    const write = journal.apply('run', 'a.txt', 'two');
    const rollback = journal.rollbackRun('run');
    await Promise.all([write, rollback]);
    expect(ws.files.get('a.txt')).toBe('one');
  });

  it('reports when there is nothing to undo', async () => {
    expect(await new EditJournal(new MemoryWorkspace()).undoLast()).toEqual({ restored: [], conflicts: [] });
  });
});

describe('ApprovalGate', () => {
  const change = { kind: 'change' as const, path: 'a', before: 'x', after: 'y', accepted: [1], rejected: [], total: 1 };

  it('keys on content, ignoring object key order', () => {
    expect(approvalKey('t', { a: 1, b: { c: 2, d: [1, 2] } })).toBe(approvalKey('t', { b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(approvalKey('t', { a: 1 })).not.toBe(approvalKey('t', { a: 2 }));
    expect(approvalKey('t', { a: 1 })).not.toBe(approvalKey('u', { a: 1 }));
  });

  it('honours an approval exactly once', () => {
    const gate = new ApprovalGate();
    gate.openRun();
    gate.record('key', change);
    expect(gate.consume('key')).toEqual(change);
    expect(gate.consume('key')).toBeUndefined();
  });

  it('gives nothing after the run closes, so a late tool call cannot write', () => {
    const gate = new ApprovalGate();
    gate.openRun();
    gate.record('key', change);
    gate.closeRun();
    expect(gate.consume('key')).toBeUndefined();
    gate.record('late', change);
    expect(gate.consume('late')).toBeUndefined();
  });
});

describe('paths', () => {
  it('normalises workspace paths', () => {
    expect(toWorkspacePath('/w', 'src/./a.py')).toBe('src/a.py');
    expect(toWorkspacePath('/w', '/w/src/a.py')).toBe('src/a.py');
  });

  it.each(['../etc/passwd', '/etc/passwd', 'src/../../x', '.git/config', '.git', '', '   ', '.'])('refuses %j', input => {
    expect(() => toWorkspacePath('/w', input)).toThrow(ToolInputError);
  });

  it('flags files that may hold secrets', () => {
    for (const path of ['.env', 'a/.env', '.env.local', 'server.pem', 'a.key', 'id_rsa', '.npmrc']) {
      expect(isSensitivePath(path), path).toBe(true);
    }
    for (const path of ['.env.example', 'src/env.py', 'keys.py', 'src/key.ts']) {
      expect(isSensitivePath(path), path).toBe(false);
    }
  });
});

describe('applyEdits', () => {
  it('applies anchored edits in order', () => {
    const result = applyEdits('f', 'alpha\nbeta\n', [
      { old_text: 'alpha', new_text: 'ALPHA' },
      { old_text: 'beta', new_text: 'BETA' },
    ]);
    expect(result).toEqual({ ok: true, proposed: 'ALPHA\nBETA\n' });
  });

  it('adapts to the line endings of the file', () => {
    expect(applyEdits('f', 'a\r\nb\r\nc\r\n', [{ old_text: 'a\nb', new_text: 'x\ny' }])).toEqual({ ok: true, proposed: 'x\r\ny\r\nc\r\n' });
  });

  it.each([
    ['missing text', 'nope', /not found/],
    ['ambiguous text', 'dup', /more than once/],
    ['empty text', '', /empty/],
  ])('rejects %s with an actionable reason', (_name, oldText, reason) => {
    const result = applyEdits('f', 'dup dup', [{ old_text: oldText, new_text: 'x' }]);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toMatch(reason);
  });

  it('rejects edits that change nothing', () => {
    const result = applyEdits('f', 'same', [{ old_text: 'same', new_text: 'same' }]);
    expect(result.ok ? '' : result.reason).toMatch(/change nothing/);
  });
});

describe('normalizeToolCall', () => {
  it('reads a direct call', () => {
    expect(
      normalizeToolCall({ id: 'c', functionName: 'synapse-editor__propose_edit', toolInfoName: 'propose_edit', argumentsJson: '{"path":"a"}' }),
    ).toEqual({ id: 'c', name: 'propose_edit', args: { path: 'a' } });
  });

  it('unwraps a deferred call, so its key matches what the MCP server receives', () => {
    const inner = { path: 'a', edits: [{ old_text: 'x', new_text: 'y' }] };
    const call = normalizeToolCall({
      id: 'c',
      functionName: 'call_tool',
      toolInfoName: 'propose_edit',
      argumentsJson: JSON.stringify({ mcp_server: 'synapse-editor', tool_name: 'propose_edit', input: inner }),
    });
    expect(call.name).toBe('propose_edit');
    expect(approvalKey(call.name, call.args)).toBe(approvalKey('propose_edit', inner));
  });

  it('flags malformed JSON instead of guessing', () => {
    expect(normalizeToolCall({ id: 'c', functionName: 'read_file', argumentsJson: '{"path":' }).parseError).toBeDefined();
    expect(normalizeToolCall({ id: 'c', functionName: 'read_file', argumentsJson: '[1]' }).parseError).toBeDefined();
  });

  it('treats empty arguments as an empty object', () => {
    expect(normalizeToolCall({ id: 'c', functionName: 'list_files', argumentsJson: '' }).args).toEqual({});
  });
});

describe('FallbackPolicy', () => {
  const config = { models: ['a/one', 'b/two'], attemptsPerModel: 2, backoffMs: 100 };

  it('retries a transient failure with backoff, then switches, then gives up', () => {
    const policy = new FallbackPolicy(config);
    expect(policy.next('connect ECONNREFUSED')).toEqual({ action: 'retry', model: 'a/one', attempt: 2, delayMs: 100 });
    expect(policy.next('connect ECONNREFUSED')).toEqual({ action: 'switch', from: 'a/one', model: 'b/two' });
    expect(policy.currentModel).toBe('b/two');
    expect(policy.next('timeout')).toEqual({ action: 'retry', model: 'b/two', attempt: 2, delayMs: 100 });
    expect(policy.next('timeout')).toEqual({ action: 'give-up', tried: ['a/one', 'b/two'] });
  });

  it('skips retries for an auth failure, since those never heal', () => {
    expect(new FallbackPolicy(config).next('401 Unauthorized: invalid api key')).toEqual({ action: 'switch', from: 'a/one', model: 'b/two' });
  });

  it('gives a clear error with no models', () => {
    expect(() => new FallbackPolicy({ ...config, models: [] })).toThrow(/synapse\.models/);
  });

  it('doubles the delay on each retry', () => {
    const policy = new FallbackPolicy({ models: ['a/one'], attemptsPerModel: 4, backoffMs: 100 });
    const delays = [policy.next('x'), policy.next('x'), policy.next('x')].map(step => (step.action === 'retry' ? step.delayMs : -1));
    expect(delays).toEqual([100, 200, 400]);
  });

  it.each(['401', 'Unauthorized', 'Invalid API key provided', 'authentication failed'])('classes %j as auth', message => {
    expect(classifyFailure(message)).toBe('auth');
  });

  it.each(['ECONNREFUSED', '503 Service Unavailable', 'fetch failed', 'rate limit', 'overloaded'])('classes %j as transient', message => {
    expect(classifyFailure(message)).toBe('transient');
  });
});
