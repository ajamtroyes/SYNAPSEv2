import { describe, expect, it } from 'vitest';
import { assembleMessage, buildLedger, parseMentions, resolveMentions } from '../../extension/src/core/mentions';
import { estimateTokens, extractDefinitions, retrieve, tokenize } from '../../extension/src/core/retrieval';
import { MemoryWorkspace } from '../helpers/memoryWorkspace';

const corpus = (files: Record<string, string>) => {
  const ws = new MemoryWorkspace(files);
  return { ws, source: { listFiles: () => ws.listFiles(), read: (path: string) => ws.read(path) } };
};

describe('tokenize', () => {
  it('splits identifiers and matches word forms', () => {
    expect(tokenize('parseConfigFile')).toEqual(['parse', 'config', 'file']);
    expect(tokenize('get_debug_flag')).toEqual(['get', 'debug', 'flag']);
    expect(tokenize('commands')).toEqual(tokenize('command'));
    expect(tokenize('documented')).toEqual(tokenize('document'));
  });

  it('drops stopwords', () => {
    expect(tokenize('add the new thing to it')).toEqual(['add', 'thing']);
  });
});

describe('extractDefinitions', () => {
  it('finds definitions across languages', () => {
    const text = ['def alpha():', 'class Beta:', '    async def gamma(self):', 'export function delta() {}', 'export const epsilon = (x) => x;', 'func zeta() {}'].join('\n');
    expect(extractDefinitions(text).map(item => item.name)).toEqual(['alpha', 'Beta', 'gamma', 'delta', 'epsilon', 'zeta']);
  });
});

describe('retrieve', () => {
  it('ranks the file about the query first and explains why', async () => {
    const { source } = corpus({
      'src/billing.py': 'def charge_invoice(invoice):\n    return invoice.total\n',
      'src/unrelated.py': 'def render_page():\n    return "<html>"\n',
    });
    const result = await retrieve(source, 'charge an invoice', { budgetTokens: 1000 });
    expect(result.snippets[0]?.path).toBe('src/billing.py');
    expect(result.snippets[0]?.reason).toMatch(/charge_invoice/);
    expect(result.snippets.map(item => item.path)).not.toContain('src/unrelated.py');
  });

  it('never spends more than the budget', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 40; index += 1) {
      files[`src/mod${String(index)}.py`] = `def widget_${String(index)}():\n${'    widget = 1\n'.repeat(30)}`;
    }
    const { source } = corpus(files);
    for (const budgetTokens of [200, 800, 3000]) {
      const result = await retrieve(source, 'widget', { budgetTokens });
      expect(result.usedTokens).toBeLessThanOrEqual(budgetTokens);
      expect(result.snippets.reduce((sum, item) => sum + item.tokens, 0)).toBe(result.usedTokens);
      expect(result.snippets.length).toBeGreaterThan(0);
    }
  });

  it('reports what the budget left out', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 40; index += 1) {
      files[`src/mod${String(index)}.py`] = `def widget_${String(index)}():\n${'    widget = 1\n'.repeat(30)}`;
    }
    const result = await retrieve(corpus(files).source, 'widget', { budgetTokens: 400 });
    expect(result.omitted.length).toBeGreaterThan(0);
  });

  it('spreads the budget across files rather than filling it from one', async () => {
    const { source } = corpus({
      'src/huge.py': Array.from({ length: 30 }, (_, index) => `def widget_${String(index)}():\n    widget = 1\n`).join(''),
      'src/small_a.py': 'def widget_a():\n    widget = 1\n',
      'src/small_b.py': 'def widget_b():\n    widget = 1\n',
    });
    const result = await retrieve(source, 'widget', { budgetTokens: 200 });
    expect(new Set(result.snippets.map(item => item.path)).size).toBe(3);
  });

  it('pulls in the test and docs that travel with a source file', async () => {
    const { source } = corpus({
      'src/app/cli.py': 'def routes_command():\n    """Show routes command."""\n',
      'src/app/other.py': 'def helper():\n    return 1\n',
      'tests/test_cli.py': 'def test_routes():\n    assert command\n',
      'docs/cli.rst': 'Commands\n========\n\nThe command line.\n',
    });
    const result = await retrieve(source, 'add a routes command', { budgetTokens: 2000 });
    const test = result.snippets.find(item => item.path === 'tests/test_cli.py');
    expect(test?.reason).toMatch(/companion of src\/app\/cli\.py/);
    expect(result.snippets.map(item => item.path)).toContain('docs/cli.rst');
  });

  it('skips excluded paths, secrets, binaries, lockfiles and vendored code', async () => {
    const { source } = corpus({
      'a.py': 'widget',
      'mentioned.py': 'widget',
      '.env': 'WIDGET_SECRET=widget',
      'server.key': 'widget',
      'image.png': 'widget',
      'package-lock.json': '{"widget": 1}',
      'node_modules/lib/index.js': 'widget',
      '.venv/lib/x.py': 'widget',
    });
    const result = await retrieve(source, 'widget', { budgetTokens: 1000, excludePaths: new Set(['mentioned.py']) });
    expect(result.snippets.map(item => item.path)).toEqual(['a.py']);
  });

  it('returns nothing, without failing, when nothing matches', async () => {
    const result = await retrieve(corpus({ 'a.py': 'alpha' }).source, 'zzzz', { budgetTokens: 1000 });
    expect(result).toMatchObject({ snippets: [], usedTokens: 0 });
  });

  it('splits long files, so one chunk cannot exceed a small budget', async () => {
    const long = Array.from({ length: 400 }, () => 'widget = 1').join('\n');
    const result = await retrieve(corpus({ 'a.py': long }).source, 'widget', { budgetTokens: 400, maxFileShare: 1 });
    expect(result.snippets.length).toBeGreaterThan(0);
    expect(result.usedTokens).toBeLessThanOrEqual(400);
  });

  it('matches "falling back" to fallback and "retried" to retry, as people write them', async () => {
    const { source } = corpus({
      'src/fallback.ts': 'export class FallbackPolicy {\n  retry() {}\n}\n',
      'src/other.ts': 'export function render() {\n  return 1;\n}\n',
    });
    const result = await retrieve(source, 'how often it is retried before falling back', { budgetTokens: 1000 });
    expect(result.snippets[0]?.path).toBe('src/fallback.ts');
    expect(tokenize('retried retries')).toEqual(['retry', 'retry']);
  });

  it('prefers the code to prose that only describes it', async () => {
    const { source } = corpus({
      'docs/design.md': '# Widget cache\n\nThe widget cache keeps widget results so the widget cache stays warm.\n',
      'src/widget_cache.py': 'def widget_cache():\n    return {}\n',
    });
    const result = await retrieve(source, 'widget cache', { budgetTokens: 1000 });
    expect(result.snippets[0]?.path).toBe('src/widget_cache.py');
  });

  it('treats # as a heading only in Markdown, since in Python it is a comment', async () => {
    const python = Array.from({ length: 10 }, (_, index) => `# widget note ${String(index)}`).join('\n');
    const markdown = '# Widgets\n\nAll about the widget.\n\nMore text here.\n\n# Other\n\nNothing relevant here.\n\nAt all.\n';
    const result = await retrieve(corpus({ 'a.py': python, 'b.md': markdown }).source, 'widget', { budgetTokens: 1000 });
    expect(result.snippets.find(item => item.path === 'a.py')?.reason).not.toMatch(/section/);
    expect(result.snippets.find(item => item.path === 'b.md')?.reason).toMatch(/section "Widgets"/);
  });

  it('does not count a long file as better just for matching many times', async () => {
    const repeated = Array.from({ length: 200 }, (_, index) => `def other_${String(index)}():\n    widget = 1\n`).join('');
    const { source } = corpus({
      'src/long.py': repeated,
      'src/focused.py': 'def widget_gear_ratio():\n    """Widget gear ratio."""\n    return widget_gear\n',
    });
    const result = await retrieve(source, 'widget gear ratio', { budgetTokens: 1000 });
    expect(result.snippets[0]?.path).toBe('src/focused.py');
  });

  it('treats asking for tests as intent, not as a search for the word "test"', async () => {
    const { source } = corpus({
      'src/billing.py': 'def charge_invoice():\n    pass\n',
      'src/other.py': 'def render_page():\n    pass\n',
      'tests/test_other.py': 'def test_render_page_test():\n    test = 1\n    assert test\n',
      'tests/test_billing.py': 'def test_charge():\n    charge_invoice()\n',
    });
    const result = await retrieve(source, 'charge the invoice and cover it with a test', { budgetTokens: 1000 });
    expect(result.snippets[0]?.path).toBe('src/billing.py');
    expect(result.snippets.map(item => item.path)).not.toContain('tests/test_other.py');
  });

  it('gives the top file more depth than those below it', async () => {
    const section = (name: string, count: number) =>
      Array.from({ length: count }, (_, index) => `def ${name}_widget_${String(index)}():\n    widget = 1\n    return widget\n\n`).join('');
    const { source } = corpus({ 'src/widget.py': section('top', 12), 'src/lesser.py': section('low', 12) });
    const result = await retrieve(source, 'widget', { budgetTokens: 200, maxFileShare: 1 });
    const count = (path: string) => result.snippets.filter(item => item.path === path).length;
    expect(count('src/widget.py')).toBeGreaterThan(count('src/lesser.py'));
  });

  it('clips a chunk larger than the budget instead of returning nothing, with honest line numbers', async () => {
    const text = `def widget():\n${Array.from({ length: 50 }, (_, index) => `    widget_${String(index)} = 1`).join('\n')}\n`;
    const result = await retrieve(corpus({ 'a.py': text }).source, 'widget', { budgetTokens: 100 });
    const snippet = result.snippets[0];
    expect(snippet?.tokens).toBeLessThanOrEqual(40);
    expect(text.split('\n').slice((snippet?.startLine ?? 1) - 1, snippet?.endLine).join('\n')).toBe(snippet?.text);
  });

  it('gives line numbers that match the file', async () => {
    const text = 'import os\n\n\ndef target_function():\n    return 1\n';
    const result = await retrieve(corpus({ 'a.py': text }).source, 'target function', { budgetTokens: 500 });
    const snippet = result.snippets[0];
    expect(text.split('\n').slice((snippet?.startLine ?? 1) - 1, snippet?.endLine).join('\n')).toBe(snippet?.text);
  });
});

describe('mentions', () => {
  it('parses files and symbols, and ignores email addresses', () => {
    expect(parseMentions('see @src/a.py and @MyClass, not me@example.com (@b.ts). End @c.py.')).toEqual(['src/a.py', 'MyClass', 'b.ts', 'c.py']);
  });

  it('resolves a file, then a symbol, and reports what it could not find', async () => {
    const ws = new MemoryWorkspace({ 'src/a.py': 'x = 1\n', 'src/b.py': 'import os\n\ndef my_func():\n    return 2\n' });
    const result = await resolveMentions(ws, ['src/a.py', 'my_func', 'nope'], 1000);
    expect(result.resolved.map(item => [item.kind, item.path])).toEqual([
      ['file', 'src/a.py'],
      ['symbol', 'src/b.py'],
    ]);
    expect(result.resolved[1]?.text).toContain('def my_func');
    expect(result.unresolved).toEqual(['nope']);
  });

  it('truncates to the budget and says so', async () => {
    const ws = new MemoryWorkspace({ 'big.py': 'x'.repeat(10_000) });
    const result = await resolveMentions(ws, ['big.py'], 100);
    expect(result.resolved[0]?.truncated).toBe(true);
    expect(result.usedTokens).toBeLessThanOrEqual(100);
  });

  it('refuses to read a secret, or anything outside the workspace, even when mentioned', async () => {
    const ws = new MemoryWorkspace({ '.env': 'SECRET=1' });
    const result = await resolveMentions(ws, ['.env', '../outside.py'], 100);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual(['.env', '../outside.py']);
  });
});

describe('assembleMessage and buildLedger', () => {
  it('keeps the task apart from the data and accounts for the budget', async () => {
    const ws = new MemoryWorkspace({ 'a.py': 'def widget():\n    return 1\n', 'b.py': 'widget = 2\n' });
    const mentions = await resolveMentions(ws, ['a.py'], 1000);
    const retrieval = await retrieve({ listFiles: () => ws.listFiles(), read: path => ws.read(path) }, 'widget', {
      budgetTokens: 1000 - mentions.usedTokens,
      excludePaths: new Set(['a.py']),
    });
    const message = assembleMessage('Fix the widget', mentions, retrieval);
    expect(message.startsWith('<task>\nFix the widget\n</task>')).toBe(true);
    expect(message).toContain('<mentioned path="a.py"');
    expect(message).toContain('<snippet path="b.py"');

    const ledger = buildLedger(mentions, retrieval, 1000);
    expect(ledger.usedTokens).toBe(mentions.usedTokens + retrieval.usedTokens);
    expect(ledger.entries.map(entry => entry.path)).toEqual(['a.py', 'b.py']);
    expect(ledger.entries[0]?.why).toBe('you mentioned @a.py');
    expect(estimateTokens('abcd')).toBe(1);
  });
});
