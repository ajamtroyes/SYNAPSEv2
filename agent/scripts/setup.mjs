// Registers the model providers from a config file with a running TrueForge, then prints the value
// for the "synapse.models" setting. API keys are read from the environment or .env, never the file.
//
//   npm run setup:models                                     uses agent/models.json
//   npm run setup:models -- --config agent/models.mock.example.json
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argument = name => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const fail = message => {
  console.error(`Error: ${message}`);
  process.exit(1);
};

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const base = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const configPath = resolve(argument('--config') ?? 'agent/models.json');
if (!existsSync(configPath)) {
  fail(`${configPath} does not exist. Copy agent/models.example.json to agent/models.json and edit it.`);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (!Array.isArray(config.providers) || config.providers.length === 0) {
  fail('The config needs a non-empty "providers" array.');
}
if (!Array.isArray(config.chain) || config.chain.length === 0) {
  fail('The config needs a non-empty "chain" array of provider/model names, primary first.');
}

function toManifest(provider) {
  const { api_key_env: keyEnv, ...manifest } = provider;
  if ('api_key' in manifest || 'auth' in manifest) {
    fail(`Provider ${provider.name ?? provider.type} has a key in the config file. Name an environment variable with "api_key_env" instead.`);
  }
  if (!keyEnv) {
    return manifest;
  }
  const key = process.env[keyEnv];
  if (!key) {
    fail(`Provider ${provider.name ?? provider.type} needs ${keyEnv}. Set it in your environment or in .env (see .env.example).`);
  }
  return { ...manifest, auth: { api_key: key } };
}

async function api(method, path, body) {
  let response;
  try {
    response = await fetch(new URL(path, base), {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    fail(`Cannot reach TrueForge at ${base} (${error.cause?.code ?? error.message}). Start it with: npm run trueforge`);
  }
  const text = await response.text();
  if (!response.ok) {
    fail(`${method} ${path} returned ${response.status}: ${text}`);
  }
  return text === '' ? {} : JSON.parse(text);
}

for (const provider of config.providers) {
  await api('PUT', '/api/v1/settings/model-providers', { manifest: toManifest(provider) });
  console.log(`Registered provider ${provider.name ?? provider.type}`);
}

const available = new Set((await api('GET', '/api/v1/models')).data.map(model => model.name));
const missing = config.chain.filter(name => !available.has(name));
if (missing.length > 0) {
  fail(`Not configured in TrueForge: ${missing.join(', ')}. Available: ${[...available].join(', ')}`);
}

console.log('\nAdd this to your VS Code settings (the first model is primary, the rest are fallbacks):\n');
console.log(`  "synapse.models": ${JSON.stringify(config.chain)}\n`);
