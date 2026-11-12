import { type ApprovalGate, approvalKey } from './approvalGate';
import { ReviewSession } from './hunks';
import { toWorkspacePath, ToolInputError } from './paths';
import type { FilePort } from './ports';
import { applyEdits, type SearchReplaceEdit } from './proposals';
import type { NormalizedToolCall } from './toolCalls';

export type ApprovalDecision = { status: 'allow' } | { status: 'deny'; reason: string };

/** The editor side of a review. Implemented with real UI in the extension and fakes in tests. */
export interface ReviewUi {
  /** Resolves once every hunk is decided, or with false if the review was abandoned. */
  reviewHunks(session: ReviewSession, rationale: string, position: { index: number; total: number }): Promise<boolean>;
  confirmCommand(command: string, rationale: string): Promise<boolean>;
  closeAll(): void;
}

export interface ReviewCoordinatorDeps {
  root: string;
  files: Pick<FilePort, 'read'>;
  gate: ApprovalGate;
  ui: ReviewUi;
}

const denied = (reason: string): ApprovalDecision => ({ status: 'deny', reason });

/**
 * Turns TrueForge's approval pause into the editor's review. A partly accepted proposal is still
 * "allow": the approval recorded in the gate carries the accepted result, and the MCP tool applies
 * that rather than the arguments the model sent.
 */
export class ReviewCoordinator {
  constructor(private readonly deps: ReviewCoordinatorDeps) {}

  async decide(call: NormalizedToolCall, position: { index: number; total: number }): Promise<ApprovalDecision> {
    if (call.parseError) {
      return denied(`The arguments for ${call.name} were not valid JSON (${call.parseError}). Send them again.`);
    }
    try {
      switch (call.name) {
        case 'propose_edit':
          return await this.reviewEdit(call, position);
        case 'create_file':
          return await this.reviewCreate(call, position);
        case 'run_command':
          return await this.reviewCommand(call);
        default:
          return denied(`Tool ${call.name} has no review flow, so it was not run.`);
      }
    } catch (error) {
      if (error instanceof ToolInputError) {
        return denied(error.message);
      }
      throw error;
    }
  }

  private async reviewEdit(call: NormalizedToolCall, position: { index: number; total: number }): Promise<ApprovalDecision> {
    const path = toWorkspacePath(this.deps.root, String(call.args['path'] ?? ''));
    const edits = call.args['edits'];
    if (!Array.isArray(edits) || edits.length === 0) {
      return denied('propose_edit needs a non-empty "edits" array of { old_text, new_text }.');
    }
    const before = await this.deps.files.read(path);
    if (before === undefined) {
      return denied(`${path} does not exist. Use create_file for new files.`);
    }
    const proposal = applyEdits(path, before, edits as SearchReplaceEdit[]);
    if (!proposal.ok) {
      return denied(proposal.reason);
    }
    return this.runHunkReview(call, path, before, proposal.proposed, position);
  }

  private async reviewCreate(call: NormalizedToolCall, position: { index: number; total: number }): Promise<ApprovalDecision> {
    const path = toWorkspacePath(this.deps.root, String(call.args['path'] ?? ''));
    if ((await this.deps.files.read(path)) !== undefined) {
      return denied(`${path} already exists. Use propose_edit to change it.`);
    }
    return this.runHunkReview(call, path, undefined, String(call.args['content'] ?? ''), position);
  }

  private async runHunkReview(
    call: NormalizedToolCall,
    path: string,
    before: string | undefined,
    proposed: string,
    position: { index: number; total: number },
  ): Promise<ApprovalDecision> {
    const session = new ReviewSession(path, before ?? '', proposed);
    const finished = await this.deps.ui.reviewHunks(session, String(call.args['rationale'] ?? ''), position);
    if (!finished) {
      return denied('The review was abandoned, so nothing was changed.');
    }
    const { accepted, rejected, after } = session.result();
    if (accepted.length === 0) {
      return denied(`The user rejected every hunk for ${path}. Do not propose the same change again.`);
    }
    this.deps.gate.record(approvalKey(call.name, call.args), {
      kind: 'change',
      path,
      before,
      after,
      accepted,
      rejected,
      total: session.hunks.length,
    });
    return { status: 'allow' };
  }

  private async reviewCommand(call: NormalizedToolCall): Promise<ApprovalDecision> {
    const command = String(call.args['command'] ?? '');
    if (command.trim() === '') {
      return denied('run_command needs a non-empty "command".');
    }
    if (!(await this.deps.ui.confirmCommand(command, String(call.args['rationale'] ?? '')))) {
      return denied(`The user declined to run: ${command}`);
    }
    this.deps.gate.record(approvalKey(call.name, call.args), { kind: 'command' });
    return { status: 'allow' };
  }
}
