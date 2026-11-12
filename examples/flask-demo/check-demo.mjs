// Run before F5 opens the demo folder. Without it, VS Code silently opens a missing folder path as a
// new, empty file, and that file then blocks setup.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const demo = resolve(process.argv[2] ?? '.cache/flask-demo');
let stats;
try {
  stats = statSync(demo);
} catch {
  console.error(`The Flask demo is not set up yet. Run: npm run demo:flask -- setup`);
  process.exit(1);
}
if (!stats.isDirectory()) {
  console.error(`${demo} is a file, not the Flask checkout. Delete it, then run: npm run demo:flask -- setup`);
  process.exit(1);
}
console.log(`Flask demo found at ${demo}`);
