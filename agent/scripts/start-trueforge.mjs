// Starts TrueForge in local mode, configured so it can reach the extension's MCP server.
//
// TrueForge's outbound guard blocks loopback addresses by default, and the extension's MCP server
// (and any local model) lives on loopback. Without this allow-list the agent has no tools.
import { spawn } from 'node:child_process';

// Pinned so a new release cannot change behaviour during a demo. Override to try another:
// TRUEFORGE_VERSION=latest npm run trueforge
const version = process.env.TRUEFORGE_VERSION ?? '0.183.0';
const env = {
  ...process.env,
  OUTBOUND_URL_ALLOWED_HOSTS: process.env.OUTBOUND_URL_ALLOWED_HOSTS ?? '["127.0.0.1","localhost"]',
};

console.log(`Starting TrueForge ${version} with OUTBOUND_URL_ALLOWED_HOSTS=${env.OUTBOUND_URL_ALLOWED_HOSTS}`);
console.log(`Local mode has no login, so keep it on this machine. UI: http://localhost:${env.PORT ?? '8790'}`);

const child = spawn('npx', ['--yes', `@truefoundry/trueforge@${version}`], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
child.on('exit', code => {
  process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
