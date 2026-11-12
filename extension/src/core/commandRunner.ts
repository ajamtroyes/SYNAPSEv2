import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { delimiter } from 'node:path';

export interface CommandResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  aborted: boolean;
}

export interface CommandOptions {
  cwd: string;
  /** Prepended to PATH, for example a project's virtualenv bin directory. */
  pathPrepend?: readonly string[];
  /** TrueForge gives one MCP request two minutes by default, so stay below that. */
  timeoutMs?: number;
  maxOutputChars?: number;
}

const DEFAULT_TIMEOUT_MS = 110_000;
const DEFAULT_MAX_OUTPUT = 16_000;

function clip(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n… [${String(text.length - limit)} characters omitted] …\n${text.slice(-half)}`;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => undefined);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/** Runs agent commands. Cancel kills the process tree because the harness waits for running tools. */
export class CommandRunner {
  private readonly running = new Set<ChildProcess>();
  private readonly aborted = new WeakSet<ChildProcess>();

  run(command: string, options: CommandOptions): Promise<CommandResult> {
    const limit = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
    const extra = options.pathPrepend ?? [];
    // Windows spells it "Path". Setting a second key would leave the choice between them to chance.
    const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
    const env = {
      ...process.env,
      [pathKey]: [...extra, process.env[pathKey] ?? ''].join(delimiter),
    };
    return new Promise(resolve => {
      const child = spawn(command, {
        cwd: options.cwd,
        env,
        shell: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.running.add(child);
      let output = '';
      let timedOut = false;
      const collect = (chunk: Buffer): void => {
        // Keep a bounded window: enough to clip both ends without unbounded growth.
        output = (output + chunk.toString('utf8')).slice(-limit * 4);
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const finish = (exitCode: number | null): void => {
        clearTimeout(timer);
        const aborted = this.aborted.has(child);
        this.running.delete(child);
        resolve({ exitCode, output: clip(output, limit), timedOut, aborted });
      };
      child.on('error', error => {
        output += String(error);
        finish(null);
      });
      child.on('close', finish);
    });
  }

  abortAll(): void {
    for (const child of this.running) {
      this.aborted.add(child);
      killTree(child);
    }
  }
}
