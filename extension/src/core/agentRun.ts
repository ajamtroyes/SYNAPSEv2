import type { ApprovalGate } from './approvalGate';
import { FallbackPolicy, type FallbackConfig } from './fallback';
import type { EditJournal, UndoReport } from './journal';
import type { ApprovalDecision, ReviewCoordinator } from './review';
import type { NormalizedToolCall } from './toolCalls';

export interface PendingApproval {
  threadId: string;
  call: NormalizedToolCall;
}

export type TurnOutcome =
  | { status: 'done'; output: string; costUsd?: number; totalTokens?: number }
  | { status: 'cancelled'; reason: string }
  | { status: 'error'; message: string };

/** What the run needs from a turn stream. The SDK adapter produces these; tests script them. */
export type GatewayEvent =
  | { type: 'turn-started'; turnId: string }
  | { type: 'token'; messageId: string; threadId: string; text: string }
  | { type: 'tool-call'; threadId: string; call: NormalizedToolCall; deferred: boolean }
  | { type: 'tool-result'; threadId: string; toolCallId: string; content: string }
  | { type: 'approval-required'; pending: PendingApproval[] }
  | { type: 'thread-started'; threadId: string; title: string }
  | { type: 'thread-finished'; threadId: string; title: string; error?: string }
  | { type: 'compaction'; threadId: string; phase: 'started' | 'finished' }
  | { type: 'turn-done'; outcome: TurnOutcome };

export type TurnInput =
  | { kind: 'message'; text: string }
  | { kind: 'approvals'; decisions: { threadId: string; toolCallId: string; decision: ApprovalDecision }[] };

export interface TurnGateway {
  createSession(model: string): Promise<string>;
  /** Replaces the running session's model, keeping its history. */
  switchModel(sessionId: string, model: string): Promise<void>;
  streamTurn(sessionId: string, input: TurnInput, signal: AbortSignal): AsyncIterable<GatewayEvent>;
  cancel(sessionId: string): Promise<void>;
}

export type RunStatus = 'running' | 'reviewing' | 'done' | 'cancelled' | 'failed';

export type RunEvent =
  | { type: 'status'; status: RunStatus; detail?: string }
  | { type: 'session'; sessionId: string; model: string }
  | { type: 'retry'; model: string; attempt: number; delayMs: number; reason: string }
  | { type: 'model-switch'; from: string; to: string; reason: string }
  | { type: 'rolled-back'; report: UndoReport }
  /** Totals across the run's turns, as TrueForge reports them. The write-up must state rough costs. */
  | { type: 'usage'; totalTokens: number; costUsd?: number }
  | Exclude<GatewayEvent, { type: 'turn-done' | 'approval-required' | 'turn-started' }>;

export type RunResult =
  | { status: 'done'; output: string; changedPaths: string[] }
  | { status: 'cancelled'; report: UndoReport }
  | { status: 'failed'; message: string; report: UndoReport };

export interface AgentRunDeps {
  runId: string;
  gateway: TurnGateway;
  review: Pick<ReviewCoordinator, 'decide'>;
  closeReviews: () => void;
  abortCommands: () => void;
  journal: EditJournal;
  gate: ApprovalGate;
  fallback: FallbackConfig;
  onEvent: (event: RunEvent) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const CONTINUE_MESSAGE =
  'The previous model failed part way through. Review what has already been done in this session and continue the task from there. Do not repeat completed steps.';

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * One user request, from first token to a consistent workspace. Every exit path leaves the workspace
 * either with the reviewed changes applied (done) or exactly as it started (cancelled, failed).
 */
export class AgentRun {
  private readonly abort = new AbortController();
  private readonly policy: FallbackPolicy;
  private sessionId: string | undefined;
  private cancelledReport: Promise<UndoReport> | undefined;
  private progressed = false;
  private usage: { totalTokens: number; costUsd?: number } = { totalTokens: 0 };

  constructor(private readonly deps: AgentRunDeps) {
    this.policy = new FallbackPolicy(deps.fallback);
  }

  async start(prompt: string): Promise<RunResult> {
    const { deps } = this;
    deps.gate.openRun();
    deps.onEvent({ type: 'status', status: 'running' });
    try {
      return await this.loop(prompt);
    } catch (error) {
      if (this.cancelledReport) {
        return this.finishCancelled();
      }
      return await this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      deps.gate.closeRun();
    }
  }

  /** Immediate from the user's point of view: the workspace is restored before the server stops. */
  cancel(): Promise<UndoReport> {
    if (!this.cancelledReport) {
      const { deps } = this;
      deps.gate.closeRun();
      deps.closeReviews();
      deps.abortCommands();
      this.abort.abort();
      if (this.sessionId) {
        deps.gateway.cancel(this.sessionId).catch(() => undefined);
      }
      this.cancelledReport = deps.journal.rollbackRun(deps.runId);
    }
    return this.cancelledReport;
  }

  private async loop(prompt: string): Promise<RunResult> {
    const { deps } = this;
    this.sessionId = await deps.gateway.createSession(this.policy.currentModel);
    if (this.cancelledReport) {
      deps.gateway.cancel(this.sessionId).catch(() => undefined);
      return this.finishCancelled();
    }
    deps.onEvent({ type: 'session', sessionId: this.sessionId, model: this.policy.currentModel });

    let input: TurnInput = { kind: 'message', text: prompt };
    for (;;) {
      const turn = await this.runTurn(this.sessionId, input);
      if (this.cancelledReport || turn.outcome?.status === 'cancelled') {
        // A cancel we did not start (for example a server timeout) still has to restore the workspace.
        await this.cancel();
        return this.finishCancelled();
      }
      if (!turn.outcome) {
        throw new Error('The TrueForge stream ended without a terminal event.');
      }
      if (turn.outcome.status === 'error') {
        const next = await this.handleFailure(this.sessionId, turn.outcome.message);
        if (!next) {
          return await this.fail(turn.outcome.message);
        }
        input = { kind: 'message', text: this.progressed ? CONTINUE_MESSAGE : prompt };
        continue;
      }
      if (turn.pending.length > 0) {
        input = { kind: 'approvals', decisions: await this.collectDecisions(turn.pending) };
        if (this.cancelledReport) {
          return this.finishCancelled();
        }
        deps.onEvent({ type: 'status', status: 'running' });
        continue;
      }
      deps.onEvent({ type: 'usage', ...this.usage });
      deps.onEvent({ type: 'status', status: 'done' });
      return { status: 'done', output: turn.outcome.output, changedPaths: deps.journal.changedPaths(deps.runId) };
    }
  }

  private async runTurn(
    sessionId: string,
    input: TurnInput,
  ): Promise<{ outcome: TurnOutcome | undefined; pending: PendingApproval[] }> {
    const pending: PendingApproval[] = [];
    let outcome: TurnOutcome | undefined;
    try {
      for await (const event of this.deps.gateway.streamTurn(sessionId, input, this.abort.signal)) {
        switch (event.type) {
          case 'turn-started':
            break;
          case 'approval-required':
            pending.push(...event.pending);
            break;
          case 'turn-done':
            outcome = event.outcome;
            if (outcome.status === 'done') {
              this.usage.totalTokens += outcome.totalTokens ?? 0;
              if (outcome.costUsd !== undefined) {
                this.usage.costUsd = (this.usage.costUsd ?? 0) + outcome.costUsd;
              }
            }
            break;
          default:
            if (event.type === 'token' || event.type === 'tool-result') {
              this.progressed = true;
            }
            this.deps.onEvent(event);
        }
      }
    } catch (error) {
      if (!this.cancelledReport) {
        outcome = { status: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    }
    return { outcome, pending };
  }

  /** Returns false when no model is left to try. */
  private async handleFailure(sessionId: string, message: string): Promise<boolean> {
    const { deps } = this;
    const step = this.policy.next(message);
    switch (step.action) {
      case 'retry':
        deps.onEvent({ type: 'retry', model: step.model, attempt: step.attempt, delayMs: step.delayMs, reason: message });
        await (deps.sleep ?? defaultSleep)(step.delayMs, this.abort.signal);
        return true;
      case 'switch':
        deps.onEvent({ type: 'model-switch', from: step.from, to: step.model, reason: message });
        await deps.gateway.switchModel(sessionId, step.model);
        deps.onEvent({ type: 'session', sessionId, model: step.model });
        return true;
      case 'give-up':
        return false;
    }
  }

  /** The harness requires every pending call to be answered in one resume, so all are decided first. */
  private async collectDecisions(
    pending: readonly PendingApproval[],
  ): Promise<{ threadId: string; toolCallId: string; decision: ApprovalDecision }[]> {
    const { deps } = this;
    deps.onEvent({ type: 'status', status: 'reviewing', detail: `${String(pending.length)} pending` });
    const decisions: { threadId: string; toolCallId: string; decision: ApprovalDecision }[] = [];
    for (const [index, item] of pending.entries()) {
      if (this.cancelledReport) {
        break;
      }
      const decision = await deps.review.decide(item.call, { index: index + 1, total: pending.length });
      decisions.push({ threadId: item.threadId, toolCallId: item.call.id, decision });
    }
    return decisions;
  }

  private async finishCancelled(): Promise<RunResult> {
    const report = await this.cancel();
    this.deps.onEvent({ type: 'rolled-back', report });
    this.deps.onEvent({ type: 'status', status: 'cancelled' });
    return { status: 'cancelled', report };
  }

  private async fail(message: string): Promise<RunResult> {
    const { deps } = this;
    deps.gate.closeRun();
    deps.closeReviews();
    const report = await deps.journal.rollbackRun(deps.runId);
    deps.onEvent({ type: 'rolled-back', report });
    deps.onEvent({ type: 'status', status: 'failed', detail: message });
    return { status: 'failed', message, report };
  }
}
