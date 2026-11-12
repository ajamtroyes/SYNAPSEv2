import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import coder from '../../agent/definitions/coder.json';
import inlineEdit from '../../agent/definitions/inline-edit.json';
import { AgentDefinitionSchema } from '../../extension/src/core/agentDefinition';

const ROOT = resolve(__dirname, '../..');
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

/** Everything that would be published: tracked files plus new files git would not ignore. */
function publishableFiles(): string[] {
  return execFileSync('git', ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .split('\n')
    .filter(path => path !== '' && existsSync(resolve(ROOT, path)));
}

const TEXT = /\.(ts|mjs|js|json|md|ya?ml|py|sh|css|svg|txt)$|^\.|LICENSE$/;
const textFiles = (): string[] => publishableFiles().filter(path => TEXT.test(path) && path !== 'package-lock.json');

/** Guards the rules that can disqualify the team. Each failure here is worth stopping for. */
describe('eligibility', () => {
  it('never calls a model provider directly from the extension', () => {
    const provider = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|api\.groq\.com|openrouter\.ai|api\.together|api\.fireworks|api\.moonshot/i;
    for (const path of publishableFiles().filter(file => file.startsWith('extension/src/') || file.startsWith('agent/definitions/'))) {
      expect(read(path), path).not.toMatch(provider);
    }
  });

  it('has no provider SDK as a dependency', () => {
    const manifest = JSON.parse(read('extension/package.json')) as { dependencies: Record<string, string> };
    const banned = /^(openai|@anthropic-ai\/|@google\/generative-ai|@google\/genai|ai$|@ai-sdk\/|groq-sdk|cohere-ai|ollama$|@mistralai\/|langchain|@langchain\/)/;
    expect(Object.keys(manifest.dependencies).filter(name => banned.test(name))).toEqual([]);
    expect(manifest.dependencies).toHaveProperty(['@truefoundry/trueforge-sdk']);
  });

  it('keeps the model out of agent definitions, so it stays the user\'s configuration', () => {
    for (const definition of [coder, inlineEdit]) {
      expect(definition).not.toHaveProperty('model');
      expect(AgentDefinitionSchema.safeParse(definition).success).toBe(true);
    }
  });

  it('hard-codes no model name in extension code', () => {
    const modelName = /\b(gpt-\d|claude-(fable|opus|sonnet|haiku)|gemini-\d|llama-?\d|qwen\d?)/i;
    for (const path of publishableFiles().filter(file => file.startsWith('extension/src/'))) {
      expect(read(path), path).not.toMatch(modelName);
    }
  });

  it('exposes editor capabilities only through MCP, keeping core free of the editor', () => {
    for (const path of publishableFiles().filter(file => /^extension\/src\/(core|mcp)\/.*\.ts$/.test(file))) {
      expect(read(path), path).not.toMatch(/from 'vscode'/);
    }
  });

  it('gates every writing tool by name in every definition that can use it', () => {
    const writers = ['propose_edit', 'create_file', 'run_command'];
    expect(coder.mcp_servers[0]?.require_approval_for_tools).toEqual(expect.arrayContaining(writers));
    expect(inlineEdit.mcp_servers[0]?.require_approval_for_tools).toEqual(['propose_edit']);
    expect(inlineEdit.mcp_servers[0]?.enable_tools).toEqual(['read_file', 'propose_edit']);
  });
});

describe('secrets', () => {
  const KEY_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /\bAIza[0-9A-Za-z_-]{30,}/,
    /\bghp_[A-Za-z0-9]{30,}/,
    /\bgsk_[A-Za-z0-9]{30,}/,
    /\bxox[abp]-[A-Za-z0-9-]{20,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];

  it('commits nothing that looks like a key', () => {
    for (const path of textFiles().filter(file => file !== 'tests/repo/compliance.test.ts')) {
      const text = read(path);
      for (const pattern of KEY_PATTERNS) {
        expect(pattern.test(text), `${path} matches ${String(pattern)}`).toBe(false);
      }
    }
  });

  it('ignores the files that hold real keys', () => {
    const ignored = (path: string): boolean => {
      try {
        execFileSync('git', ['-C', ROOT, 'check-ignore', '-q', path]);
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored('.env')).toBe(true);
    expect(ignored('agent/models.json')).toBe(true);
    expect(ignored('.env.example')).toBe(false);
    expect(ignored('agent/models.example.json')).toBe(false);
  });

  it('ships example model configurations that name variables instead of holding keys', () => {
    for (const path of ['agent/models.example.json', 'agent/models.mock.example.json', 'agent/models.task-c.example.json']) {
      const config = JSON.parse(read(path)) as { providers: Record<string, unknown>[]; chain: string[] };
      expect(config.chain.length, path).toBeGreaterThan(0);
      for (const provider of config.providers) {
        expect(provider, path).not.toHaveProperty('auth');
        expect(provider, path).not.toHaveProperty('api_key');
      }
    }
  });
});

describe('submission requirements', () => {
  it('declares the starting point and setup steps in the README', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/^## Starting point/m);
    expect(readme).toMatch(/from scratch/i);
    expect(readme).toContain('npm run trueforge');
    expect(readme).toContain('agent/models.example.json');
    expect(readme).toContain('agent/definitions');
  });

  it('has a licence', () => {
    expect(read('LICENSE')).toMatch(/MIT License/);
  });

  it('keeps the eight required write-up headings, in order', () => {
    const headings = [...read('docs/competition/write-up-template.md').matchAll(/^## \d\. (.+)$/gm)].map(match => match[1]);
    expect(headings).toEqual(['Team', 'Starting point', 'Architecture on TrueForge', 'How context is selected', 'Model setup', 'Scorecard', 'Tools used', 'Known limitations']);
  });

  it('pins the same Flask commit everywhere', () => {
    const commit = '22d924701a6ae2e4cd01e9a15bbaf3946094af65';
    expect(read('tests/golden/fetch-flask.mjs')).toContain(commit);
    expect(read('examples/flask-demo/flask-demo.sh')).toContain(commit);
  });

  it('keeps the SDK and the TrueForge server on the same pinned version', () => {
    const sdk = (JSON.parse(read('extension/package.json')) as { dependencies: Record<string, string> }).dependencies['@truefoundry/trueforge-sdk'];
    expect(read('agent/scripts/start-trueforge.mjs')).toContain(`'${String(sdk)}'`);
  });
});

describe('team rules', () => {
  it('keeps both attribution rules', () => {
    for (const path of ['CLAUDE.md', 'CONTRIBUTING.md', '.claude/rules/attribution.md']) {
      expect(read(path), path).toMatch(/Never add `Co-Authored-By` lines to commit messages/);
      expect(read(path), path).toMatch(/Never add "Generated with Claude Code"/);
    }
  });

  it('does not put attribution in the pull request template', () => {
    expect(read('.github/pull_request_template.md')).not.toMatch(/Generated with|Co-Authored-By/i);
  });
});
