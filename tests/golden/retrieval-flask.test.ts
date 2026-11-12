import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { retrieve, type RetrievalCorpus, type SelectedSnippet } from '../../extension/src/core/retrieval';

const FLASK = process.env['FLASK_REPO'] ?? resolve(__dirname, '../../.cache/flask');
const available = existsSync(join(FLASK, 'src/flask/cli.py'));

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.git') {
      return [];
    }
    const full = join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [relative(FLASK, full).split('\\').join('/')];
  });
}

const corpus: RetrievalCorpus = {
  listFiles: () => Promise.resolve(walk(FLASK)),
  read: path => Promise.resolve(readFileSync(join(FLASK, path), 'utf8')),
};

/** The exact wording from the brief. Task B must succeed with no file named by the user. */
const TASK_B =
  'Add a new built-in CLI command flask config that prints the loaded application\'s configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.';
const DEFAULT_BUDGET = 8000;

const textFor = (snippets: readonly SelectedSnippet[], path: string): string =>
  snippets
    .filter(snippet => snippet.path === path)
    .map(snippet => snippet.text)
    .join('\n');

describe.skipIf(!available)('retrieval on the pinned Flask repository (run npm run test:golden)', () => {
  it('ranks the three files Task B needs ahead of everything else, without being told', async () => {
    const result = await retrieve(corpus, TASK_B, { budgetTokens: DEFAULT_BUDGET });
    const firstFiles = [...new Set(result.snippets.map(snippet => snippet.path))].slice(0, 5);
    expect(firstFiles[0]).toBe('src/flask/cli.py');
    expect(firstFiles).toContain('tests/test_cli.py');
    expect(firstFiles).toContain('docs/cli.rst');
  });

  it('includes the code that has to change, not just the right file', async () => {
    const result = await retrieve(corpus, TASK_B, { budgetTokens: DEFAULT_BUDGET });
    // Where built-in commands are registered, and an existing one to model the new one on.
    const cli = textFor(result.snippets, 'src/flask/cli.py');
    expect(cli).toContain('self.add_command(routes_command)');
    expect(cli).toContain('def routes_command');
    // An existing CLI test to copy the style of, and the docs to extend.
    expect(textFor(result.snippets, 'tests/test_cli.py')).toMatch(/def test_\w+/);
    expect(textFor(result.snippets, 'docs/cli.rst').length).toBeGreaterThan(400);
  });

  it('stays readable on screen: a handful of files, not everything that matched', async () => {
    const result = await retrieve(corpus, TASK_B, { budgetTokens: DEFAULT_BUDGET });
    expect(new Set(result.snippets.map(snippet => snippet.path)).size).toBeLessThanOrEqual(10);
    expect(result.snippets.every(snippet => snippet.tokens >= 20 || snippet.endLine - snippet.startLine >= 2)).toBe(true);
  });

  it('does not treat words common to the whole repository as evidence', async () => {
    const result = await retrieve(corpus, TASK_B, { budgetTokens: DEFAULT_BUDGET });
    const reasons = result.snippets.map(snippet => snippet.reason).join('\n');
    expect(reasons).not.toMatch(/path matches [^;]*\b(flask|test)\b/);
    expect(result.snippets[0]?.path).not.toBe('tests/test_basic.py');
  });

  it('stays inside the budget on a repository that does not fit in it', async () => {
    const result = await retrieve(corpus, TASK_B, { budgetTokens: DEFAULT_BUDGET });
    expect(result.usedTokens).toBeLessThanOrEqual(DEFAULT_BUDGET);
    expect(result.filesConsidered).toBeGreaterThan(50);
    expect(result.omitted.length).toBeGreaterThan(0);
  });

  it('explains every choice, which criterion B1 needs to be visible on screen', async () => {
    const result = await retrieve(corpus, TASK_B, { budgetTokens: DEFAULT_BUDGET });
    for (const snippet of result.snippets) {
      expect(snippet.reason.length, snippet.path).toBeGreaterThan(0);
    }
  });

  it('still gives each of them real content on a much tighter budget', async () => {
    const result = await retrieve(corpus, TASK_B, { budgetTokens: 3000 });
    for (const path of ['src/flask/cli.py', 'tests/test_cli.py', 'docs/cli.rst']) {
      expect(textFor(result.snippets, path).length, path).toBeGreaterThan(120);
    }
  });

  it('runs fast enough to do before every agent request', async () => {
    const started = performance.now();
    await retrieve(corpus, TASK_B, { budgetTokens: DEFAULT_BUDGET });
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
