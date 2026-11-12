// Fetches the competition's pinned Flask commit for the retrieval golden test. Files are only read,
// never executed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '22d924701a6ae2e4cd01e9a15bbaf3946094af65'; // pallets/flask tag 3.1.3
const target = process.env.FLASK_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../.cache/flask');
const git = (...args) => execFileSync('git', ['-C', target, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim();

if (existsSync(resolve(target, '.git')) && git('rev-parse', 'HEAD') === COMMIT) {
  console.log(`Flask ${COMMIT.slice(0, 8)} already at ${target}`);
} else {
  mkdirSync(target, { recursive: true });
  execFileSync('git', ['-C', target, 'init', '-q']);
  git('fetch', '-q', '--depth', '1', 'https://github.com/pallets/flask.git', COMMIT);
  git('checkout', '-q', 'FETCH_HEAD');
  console.log(`Fetched Flask ${COMMIT.slice(0, 8)} to ${target}`);
}
