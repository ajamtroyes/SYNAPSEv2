import * as path from 'node:path';

/** Raised for invalid tool input. The message is returned to the agent, so it must be actionable. */
export class ToolInputError extends Error {}

const SENSITIVE = [/(^|\/)\.env($|\.(?!example$))/, /\.(pem|key|p12|pfx)$/, /(^|\/)id_(rsa|ed25519|ecdsa)$/, /(^|\/)\.npmrc$/];

/**
 * Normalises agent-supplied paths to workspace-relative POSIX form and refuses anything outside
 * the workspace or inside `.git`. Repository content is untrusted input to the model, so a prompt
 * injection must not be able to walk the agent out of the workspace.
 */
export function toWorkspacePath(root: string, input: string): string {
  if (input.trim() === '' || input.includes('\0')) {
    throw new ToolInputError('Path must be a non-empty string.');
  }
  const absolute = path.resolve(root, input);
  const relative = path.relative(root, absolute);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ToolInputError(`Path "${input}" is outside the workspace.`);
  }
  const posix = relative.split(path.sep).join('/');
  if (posix === '.git' || posix.startsWith('.git/')) {
    throw new ToolInputError('Paths inside .git are not accessible.');
  }
  return posix;
}

/** Secrets must never reach a model provider, so these files are refused and left out of retrieval. */
export function isSensitivePath(posixPath: string): boolean {
  return SENSITIVE.some(pattern => pattern.test(posixPath));
}
