// Runs the end-to-end tests, which need a running TrueForge (npm run trueforge).
// Kept out of `npm test` because they change TrueForge's settings while they run.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vitest', 'run', 'tests/e2e', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, SYNAPSE_E2E: '1' },
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
