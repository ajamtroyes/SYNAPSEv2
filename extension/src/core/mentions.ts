import { isSensitivePath, toWorkspacePath, ToolInputError } from './paths';
import type { WorkspacePort } from './ports';
import { estimateTokens, type RetrievalResult } from './retrieval';

const MENTION = /(^|[\s(])@([A-Za-z0-9_][A-Za-z0-9_./-]*)/g;
const SYMBOL_CONTEXT_LINES = 40;

export function parseMentions(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    // A sentence-ending full stop is not part of the name.
    found.add((match[2] as string).replace(/\.$/, ''));
  }
  return [...found];
}

export interface ResolvedMention {
  mention: string;
  kind: 'file' | 'symbol';
  path: string;
  startLine: number;
  endLine: number;
  tokens: number;
  text: string;
  truncated: boolean;
}

export interface MentionResolution {
  resolved: ResolvedMention[];
  unresolved: string[];
  usedTokens: number;
}

async function resolveFile(ws: WorkspacePort, mention: string, budget: number): Promise<ResolvedMention | undefined> {
  let path: string;
  try {
    path = toWorkspacePath(ws.root, mention);
  } catch (error) {
    if (error instanceof ToolInputError) {
      return undefined;
    }
    throw error;
  }
  if (isSensitivePath(path)) {
    return undefined;
  }
  const content = await ws.read(path);
  if (content === undefined) {
    return undefined;
  }
  const maxChars = budget * 4;
  const truncated = content.length > maxChars;
  const text = truncated ? content.slice(0, maxChars) : content;
  return {
    mention,
    kind: 'file',
    path,
    startLine: 1,
    endLine: text.split('\n').length,
    tokens: estimateTokens(text),
    text,
    truncated,
  };
}

async function resolveSymbol(ws: WorkspacePort, mention: string, budget: number): Promise<ResolvedMention | undefined> {
  const hit = (await ws.findSymbols(mention)).find(symbol => symbol.name === mention) ?? (await ws.findSymbols(mention))[0];
  if (!hit) {
    return undefined;
  }
  const content = await ws.read(hit.path);
  if (content === undefined) {
    return undefined;
  }
  const lines = content.split('\n');
  const start = Math.max(hit.line - 1, 0);
  const end = Math.min(start + SYMBOL_CONTEXT_LINES, lines.length);
  const slice = lines.slice(start, end).join('\n');
  const maxChars = budget * 4;
  const truncated = slice.length > maxChars;
  const text = truncated ? slice.slice(0, maxChars) : slice;
  return { mention, kind: 'symbol', path: hit.path, startLine: start + 1, endLine: end, tokens: estimateTokens(text), text, truncated };
}

/** Explicit mentions spend the budget first: what the user named outranks what we inferred. */
export async function resolveMentions(ws: WorkspacePort, mentions: readonly string[], budgetTokens: number): Promise<MentionResolution> {
  const resolved: ResolvedMention[] = [];
  const unresolved: string[] = [];
  let used = 0;
  for (const mention of mentions) {
    const remaining = budgetTokens - used;
    const hit = remaining <= 0 ? undefined : ((await resolveFile(ws, mention, remaining)) ?? (await resolveSymbol(ws, mention, remaining)));
    if (hit) {
      resolved.push(hit);
      used += hit.tokens;
    } else {
      unresolved.push(mention);
    }
  }
  return { resolved, unresolved, usedTokens: used };
}

export interface ContextLedger {
  budgetTokens: number;
  usedTokens: number;
  filesConsidered: number;
  entries: { path: string; lines: string; tokens: number; why: string }[];
  omitted: { path: string; score: number }[];
  unresolved: string[];
}

export function buildLedger(mentions: MentionResolution, retrieval: RetrievalResult, budgetTokens: number): ContextLedger {
  return {
    budgetTokens,
    usedTokens: mentions.usedTokens + retrieval.usedTokens,
    filesConsidered: retrieval.filesConsidered,
    entries: [
      ...mentions.resolved.map(item => ({
        path: item.path,
        lines: `${String(item.startLine)}-${String(item.endLine)}`,
        tokens: item.tokens,
        why: `you mentioned @${item.mention}`,
      })),
      ...retrieval.snippets.map(item => ({
        path: item.path,
        lines: `${String(item.startLine)}-${String(item.endLine)}`,
        tokens: item.tokens,
        why: item.reason,
      })),
    ],
    omitted: retrieval.omitted,
    unresolved: mentions.unresolved,
  };
}

/** Text placed in the first message. Retrieved code is data, so it is fenced away from the task. */
export function assembleMessage(task: string, mentions: MentionResolution, retrieval: RetrievalResult): string {
  const parts = [`<task>\n${task}\n</task>`];
  for (const item of mentions.resolved) {
    parts.push(
      `<mentioned path="${item.path}" lines="${String(item.startLine)}-${String(item.endLine)}"${item.truncated ? ' truncated="true"' : ''}>\n${item.text}\n</mentioned>`,
    );
  }
  if (mentions.unresolved.length > 0) {
    parts.push(`<unresolved_mentions>${mentions.unresolved.join(', ')}</unresolved_mentions>`);
  }
  if (retrieval.snippets.length > 0) {
    const body = retrieval.snippets
      .map(
        item =>
          `<snippet path="${item.path}" lines="${String(item.startLine)}-${String(item.endLine)}" why="${item.reason.replace(/"/g, "'")}">\n${item.text}\n</snippet>`,
      )
      .join('\n');
    parts.push(
      `<retrieved_context budget_tokens="${String(retrieval.budgetTokens)}" used_tokens="${String(retrieval.usedTokens)}" files_considered="${String(retrieval.filesConsidered)}">\n${body}\n</retrieved_context>`,
    );
  }
  if (retrieval.omitted.length > 0) {
    parts.push(`<also_relevant_not_included>${retrieval.omitted.map(item => item.path).join(', ')}</also_relevant_not_included>`);
  }
  return parts.join('\n\n');
}
