import { z } from 'zod';
import { type ApprovalGate, approvalKey } from '../core/approvalGate';
import type { CommandResult } from '../core/commandRunner';
import type { EditJournal } from '../core/journal';
import { isSensitivePath, toWorkspacePath, ToolInputError } from '../core/paths';
import type { WorkspacePort } from '../core/ports';
import { retrieve, type RetrievalResult } from '../core/retrieval';

export interface ToolContext {
  ws: WorkspacePort;
  gate: ApprovalGate;
  journal: EditJournal;
  /** The active run, which owns any change applied now. */
  runId: () => string | undefined;
  runCommand: (command: string) => Promise<CommandResult>;
  onRetrieval?: (result: RetrievalResult) => void;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  annotations: ToolAnnotations;
  /** `args` is validated; `rawArgs` is what the approval key was computed over. */
  run(args: never, rawArgs: unknown): Promise<ToolResult>;
}

/** Below TrueForge's 6,000-token offload threshold, so results never depend on that feature. */
const MAX_RESULT_CHARS = 20_000;
const MAX_SEARCH_RESULTS = 50;
const MAX_LISTED_FILES = 300;
const MAX_SEARCH_LINE = 2_000;
const MAX_RETRIEVAL_BUDGET = 5_000;
const DEFAULT_RETRIEVAL_BUDGET = 3_000;

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false };
const WRITES: ToolAnnotations = { readOnlyHint: false, destructiveHint: true };

function safeReadablePath(ctx: ToolContext, input: string): string {
  const path = toWorkspacePath(ctx.ws.root, input);
  if (isSensitivePath(path)) {
    throw new ToolInputError(`${path} may hold secrets, so it is not available to the agent.`);
  }
  return path;
}

/** Nested quantifiers can hang the extension host on a single line. The agent can rephrase. */
function compileSearch(query: string, isRegex: boolean): (line: string) => boolean {
  if (!isRegex) {
    const needle = query.toLowerCase();
    return line => line.toLowerCase().includes(needle);
  }
  if (/\([^)]*[+*][^)]*\)\s*[+*{]/.test(query)) {
    throw new ToolInputError('That regular expression has nested quantifiers. Simplify it.');
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(query);
  } catch (error) {
    throw new ToolInputError(`Invalid regular expression: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  return line => pattern.test(line);
}

const SEARCHABLE_BINARY = /\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|gz|tar|lock|min\.js)$/i;

async function applyApprovedChange(ctx: ToolContext, toolName: string, rawArgs: unknown): Promise<ToolResult> {
  const approval = ctx.gate.consume(approvalKey(toolName, rawArgs));
  const runId = ctx.runId();
  if (approval?.kind !== 'change' || !runId) {
    return {
      text: `${toolName} was not applied: no matching approval from the user's review. Nothing was written. Propose the change again.`,
      isError: true,
    };
  }
  if ((await ctx.ws.read(approval.path)) !== approval.before) {
    return {
      text: `${approval.path} changed after the review, so nothing was written. Read it again and propose a new change.`,
      isError: true,
    };
  }
  await ctx.journal.apply(runId, approval.path, approval.after);
  const rejected =
    approval.rejected.length > 0
      ? ` The user rejected hunks ${approval.rejected.join(', ')}: that part of your proposal is NOT in the file, and must not be proposed again. Read the file before further edits.`
      : '';
  return { text: `Applied ${String(approval.accepted.length)} of ${String(approval.total)} hunks to ${approval.path}.${rejected}` };
}

export function createTools(ctx: ToolContext): ToolDefinition[] {
  const define = <S extends z.ZodType>(tool: {
    name: string;
    description: string;
    schema: S;
    annotations: ToolAnnotations;
    run: (args: z.infer<S>, rawArgs: unknown) => Promise<ToolResult>;
  }): ToolDefinition => tool as unknown as ToolDefinition;

  return [
    define({
      name: 'retrieve_context',
      description:
        'Finds the code most relevant to a natural-language query across the whole repository and returns ranked snippets within a token budget, each with the reason it was chosen. Use this first when you do not know where something lives.',
      schema: z.strictObject({
        query: z.string().min(1).describe('What you are looking for, in plain language or with identifiers.'),
        budget_tokens: z.number().int().min(200).max(MAX_RETRIEVAL_BUDGET).optional().describe('Upper bound on returned code.'),
      }),
      annotations: READ_ONLY,
      run: async args => {
        const result = await retrieve(
          { listFiles: () => ctx.ws.listFiles(), read: path => ctx.ws.read(path) },
          args.query,
          { budgetTokens: args.budget_tokens ?? DEFAULT_RETRIEVAL_BUDGET },
        );
        ctx.onRetrieval?.(result);
        const body = result.snippets
          .map(item => `--- ${item.path}:${String(item.startLine)}-${String(item.endLine)} (${item.reason})\n${item.text}`)
          .join('\n');
        const omitted = result.omitted.length > 0 ? `\nAlso relevant, not included: ${result.omitted.map(item => item.path).join(', ')}` : '';
        return {
          text: `Used ${String(result.usedTokens)} of ${String(result.budgetTokens)} tokens across ${String(result.filesConsidered)} files.\n${body}${omitted}`,
        };
      },
    }),
    define({
      name: 'read_file',
      description: 'Reads a text file from the workspace, optionally a line range. Long files are cut off, with a note saying where to continue.',
      schema: z.strictObject({
        path: z.string().min(1).describe('Path relative to the workspace root.'),
        start_line: z.number().int().min(1).optional().describe('First line to return, one-based.'),
        end_line: z.number().int().min(1).optional().describe('Last line to return, inclusive.'),
      }),
      annotations: READ_ONLY,
      run: async args => {
        const path = safeReadablePath(ctx, args.path);
        const content = await ctx.ws.read(path);
        if (content === undefined) {
          return { text: `${path} does not exist.`, isError: true };
        }
        const lines = content.split('\n');
        const first = (args.start_line ?? 1) - 1;
        const last = Math.min(args.end_line ?? lines.length, lines.length);
        let text = lines.slice(first, last).join('\n');
        let note = `${path} lines ${String(first + 1)}-${String(last)} of ${String(lines.length)}`;
        if (text.length > MAX_RESULT_CHARS) {
          text = text.slice(0, MAX_RESULT_CHARS);
          const shown = text.split('\n').length;
          note += `. Cut off: continue with start_line ${String(first + shown)}`;
        }
        return { text: `[${note}]\n${text}` };
      },
    }),
    define({
      name: 'search_workspace',
      description: 'Searches workspace files line by line. Case-insensitive for plain text, or pass is_regex for a regular expression. Returns path:line: text.',
      schema: z.strictObject({
        query: z.string().min(1),
        is_regex: z.boolean().optional(),
        path_contains: z.string().optional().describe('Only search paths containing this text, for example "tests/".'),
      }),
      annotations: READ_ONLY,
      run: async args => {
        const matches = compileSearch(args.query, args.is_regex ?? false);
        const results: string[] = [];
        let truncated = false;
        const paths = (await ctx.ws.listFiles()).filter(
          path => !isSensitivePath(path) && !SEARCHABLE_BINARY.test(path) && (!args.path_contains || path.includes(args.path_contains)),
        );
        scan: for (const path of paths) {
          const content = await ctx.ws.read(path);
          if (content === undefined || content.includes('\0')) {
            continue;
          }
          for (const [index, line] of content.split('\n').entries()) {
            if (line.length <= MAX_SEARCH_LINE && matches(line)) {
              if (results.length === MAX_SEARCH_RESULTS) {
                truncated = true;
                break scan;
              }
              results.push(`${path}:${String(index + 1)}: ${line.trim()}`);
            }
          }
        }
        if (results.length === 0) {
          return { text: `No matches for "${args.query}".` };
        }
        const suffix = truncated ? `\n[Stopped at ${String(MAX_SEARCH_RESULTS)} results. Narrow the query or use path_contains.]` : '';
        return { text: results.join('\n') + suffix };
      },
    }),
    define({
      name: 'find_symbol',
      description: 'Locates where a function, class or other symbol is defined.',
      schema: z.strictObject({ name: z.string().min(1) }),
      annotations: READ_ONLY,
      run: async args => {
        const hits = await ctx.ws.findSymbols(args.name);
        return {
          text:
            hits.length === 0
              ? `No definition found for ${args.name}. Check the name with search_workspace: it may not exist.`
              : hits
                  .slice(0, 30)
                  .map(hit => `${hit.path}:${String(hit.line)} ${hit.kind ?? 'symbol'} ${hit.name}`)
                  .join('\n'),
        };
      },
    }),
    define({
      name: 'list_files',
      description: 'Lists workspace files, optionally only paths containing some text.',
      schema: z.strictObject({ path_contains: z.string().optional() }),
      annotations: READ_ONLY,
      run: async args => {
        const paths = (await ctx.ws.listFiles()).filter(path => !args.path_contains || path.includes(args.path_contains));
        const shown = paths.slice(0, MAX_LISTED_FILES).join('\n');
        return { text: paths.length > MAX_LISTED_FILES ? `${shown}\n[${String(paths.length - MAX_LISTED_FILES)} more not shown]` : shown };
      },
    }),
    define({
      name: 'propose_edit',
      description:
        'Proposes changes to one existing file. The user reviews each hunk in the editor and may accept only some, so read this tool\'s result to learn what was really applied. Each old_text must match the file exactly once.',
      schema: z.strictObject({
        path: z.string().min(1),
        edits: z
          .array(z.strictObject({ old_text: z.string().min(1), new_text: z.string() }))
          .min(1),
        rationale: z.string().min(1).describe('One sentence, shown to the user during review.'),
      }),
      annotations: WRITES,
      run: (_args, rawArgs) => applyApprovedChange(ctx, 'propose_edit', rawArgs),
    }),
    define({
      name: 'create_file',
      description: 'Proposes a new file. The user reviews it in the editor before it is written.',
      schema: z.strictObject({
        path: z.string().min(1),
        content: z.string(),
        rationale: z.string().min(1).describe('One sentence, shown to the user during review.'),
      }),
      annotations: WRITES,
      run: (_args, rawArgs) => applyApprovedChange(ctx, 'create_file', rawArgs),
    }),
    define({
      name: 'run_command',
      description:
        'Runs a shell command in the workspace root after the user approves it, and returns its exit code and output. Commands are stopped after about 110 seconds, so do not start servers or watchers.',
      schema: z.strictObject({
        command: z.string().min(1),
        rationale: z.string().min(1).describe('One sentence, shown to the user when asking for approval.'),
      }),
      annotations: WRITES,
      run: async (args, rawArgs) => {
        const approval = ctx.gate.consume(approvalKey('run_command', rawArgs));
        if (approval?.kind !== 'command') {
          return { text: 'run_command was not run: no matching approval from the user.', isError: true };
        }
        const result = await ctx.runCommand(args.command);
        const state = result.aborted ? 'stopped by the user' : result.timedOut ? 'timed out' : `exit code ${String(result.exitCode)}`;
        return { text: `[${state}]\n${result.output}`, isError: result.exitCode !== 0 };
      },
    }),
  ];
}
