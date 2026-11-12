import { createHash } from 'node:crypto';

export interface ApprovedChange {
  kind: 'change';
  path: string;
  before: string | undefined;
  after: string;
  accepted: number[];
  rejected: number[];
  total: number;
}

export interface ApprovedCommand {
  kind: 'command';
}

export type Approval = ApprovedChange | ApprovedCommand;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Identifies a tool call by content, because TrueForge does not send its call id to the MCP server. */
export function approvalKey(toolName: string, args: unknown): string {
  return createHash('sha256').update(`${toolName}\n${canonicalJson(args)}`).digest('hex');
}

/**
 * The second lock on "no silent writes". TrueForge's approval pause is the first. Even if an agent
 * definition were misconfigured and the pause never fired, a write tool would still find no entry
 * here and refuse, because only the review UI records approvals.
 */
export class ApprovalGate {
  private readonly approvals = new Map<string, Approval>();
  private open = false;

  openRun(): void {
    this.approvals.clear();
    this.open = true;
  }

  /** Closing happens before rollback, so a tool call that arrives late cannot write afterwards. */
  closeRun(): void {
    this.approvals.clear();
    this.open = false;
  }

  get isOpen(): boolean {
    return this.open;
  }

  record(key: string, approval: Approval): void {
    if (this.open) {
      this.approvals.set(key, approval);
    }
  }

  /** Single use: an approval cannot be replayed by a repeated tool call. */
  consume(key: string): Approval | undefined {
    const approval = this.approvals.get(key);
    this.approvals.delete(key);
    return this.open ? approval : undefined;
  }
}
