// Runs the extension inside a real VS Code against a running TrueForge, with the scripted model.
//
//   npm run trueforge          (in another terminal)
//   npm run test:vscode
//
// It downloads VS Code into .vscode-test/ on first use, and a VS Code window appears while it runs.
// It re-registers the editor's MCP server in TrueForge, so reload any editor you are using afterwards.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import { startMockModel } from '../../examples/mock-model/mock-model.mjs';

// Node tries each address for only 250 ms by default, which a slow link to the VS Code download
// server can exceed even when the server is reachable.
setDefaultAutoSelectFamilyAttemptTimeout(3000);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';

const health = await fetch(new URL('/healthz', BASE)).catch(() => undefined);
if (!health?.ok) {
  console.error(`TrueForge is not reachable at ${BASE}. Start it first with: npm run trueforge`);
  process.exit(2);
}

async function api(method, path, body) {
  const response = await fetch(new URL(path, BASE), {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok && method !== 'DELETE') {
    throw new Error(`${method} ${path} returned ${response.status}: ${await response.text()}`);
  }
}

const mock = await startMockModel();
const models = [{ name: 'mock', model_id: 'mock', properties: { context_length: 100000, max_output_tokens: 4096 } }];
const provider = (name, baseUrl) => ({ manifest: { type: 'custom', name, base_url: baseUrl, auth: { api_key: 'not-a-real-key' }, models } });
await api('PUT', '/api/v1/settings/model-providers', provider('vsc-live', mock.baseUrl));
await api('PUT', '/api/v1/settings/model-providers', provider('vsc-dead', 'http://127.0.0.1:19999/v1'));

// A small workspace the agent may change freely, with settings pointing at this TrueForge.
const workspace = mkdtempSync(join(tmpdir(), 'synapse-vscode-'));
const files = {
  'src/greeter.py': 'def greet(name):\n    """Return a greeting."""\n    return "Hello, " + name\n',
  'tests/test_greeter.py': 'from greeter import greet\n\n\ndef test_greet():\n    assert greet("Ada") == "Hello, Ada"\n',
  'README.md': '# Greeter\n\nSays hello.\n',
  '.vscode/settings.json': JSON.stringify({ 'synapse.trueforgeUrl': BASE, 'synapse.models': ['vsc-live/mock'], 'synapse.retry.backoffMs': 0 }, null, 2),
};
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(workspace, path)), { recursive: true });
  writeFileSync(join(workspace, path), text);
}

let exitCode = 1;
try {
  exitCode = await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? 'stable',
    cachePath: join(ROOT, '.vscode-test'),
    extensionDevelopmentPath: join(ROOT, 'extension'),
    extensionTestsPath: join(ROOT, 'tests/vscode/suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
    extensionTestsEnv: { SYNAPSE_TEST_WORKSPACE: workspace },
  });
} catch (error) {
  console.error(error);
} finally {
  await api('DELETE', '/api/v1/settings/model-providers/vsc-live');
  await api('DELETE', '/api/v1/settings/model-providers/vsc-dead');
  await mock.close();
  rmSync(workspace, { recursive: true, force: true });
}
process.exit(exitCode);
