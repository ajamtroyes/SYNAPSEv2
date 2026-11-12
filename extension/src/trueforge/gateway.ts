import { isEventDelta, mergeEventDelta, type TrueForge, type TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { type AgentDefinition, toSdkSpec } from '../core/agentDefinition';
import type { GatewayEvent, PendingApproval, TurnGateway, TurnInput, TurnOutcome } from '../core/agentRun';
import { normalizeToolCall } from '../core/toolCalls';

/** Long enough for a slow local model. Cancel is explicit, so this is only a backstop. */
const STREAM_TIMEOUT_SECONDS = 1800;

type ModelMessage = TrueForgeApi.ModelMessageEvent;
type SessionsApi = Pick<TrueForge['sessions'], 'create' | 'update' | 'createTurnStream' | 'cancel'>;

function textOf(content: ModelMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(part => ('text' in part && typeof part.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

function toTurnInput(input: TurnInput): TrueForgeApi.TurnInputItem[] {
  if (input.kind === 'message') {
    return [{ type: 'user.message', content: input.text }];
  }
  return input.decisions.map(item => ({
    type: 'user.tool_approval',
    threadId: item.threadId,
    toolCallId: item.toolCallId,
    approval: item.decision.status === 'allow' ? { status: 'allow' } : { status: 'deny', reason: item.decision.reason },
  }));
}

function toOutcome(state: TrueForgeApi.TurnDoneEventState): TurnOutcome {
  switch (state.status) {
    case 'cancelled':
      return { status: 'cancelled', reason: state.reason };
    case 'error':
      return { status: 'error', message: state.message };
    default: {
      const unsupported = state.requiredActions?.find(action => action.type !== 'tool.approval_required');
      if (unsupported) {
        return { status: 'error', message: `The turn paused on ${unsupported.type}, which this client does not handle.` };
      }
      const { metrics } = state;
      return {
        status: 'done',
        output: textOf(state.output?.content),
        ...(metrics?.totalCostInUsd === undefined ? {} : { costUsd: metrics.totalCostInUsd }),
        ...(metrics?.totalTokens === undefined ? {} : { totalTokens: metrics.totalTokens }),
      };
    }
  }
}

/** Sessions use inline specs because only inline sessions can have their model replaced mid-run. */
export class TrueForgeGateway implements TurnGateway {
  constructor(
    private readonly sessions: SessionsApi,
    private readonly definition: AgentDefinition,
  ) {}

  async createSession(model: string): Promise<string> {
    const { data } = await this.sessions.create({ agent: { spec: toSdkSpec(this.definition, model) } });
    return data.id;
  }

  async switchModel(sessionId: string, model: string): Promise<void> {
    await this.sessions.update(sessionId, { agent: { spec: toSdkSpec(this.definition, model) } });
  }

  async cancel(sessionId: string): Promise<void> {
    await this.sessions.cancel(sessionId);
  }

  async *streamTurn(sessionId: string, input: TurnInput, signal: AbortSignal): AsyncIterable<GatewayEvent> {
    const stream = await this.sessions.createTurnStream(
      sessionId,
      { input: toTurnInput(input) },
      { abortSignal: signal, timeoutInSeconds: STREAM_TIMEOUT_SECONDS },
    );
    const messages = new Map<string, ModelMessage>();
    const reported = new Set<string>();

    /** Tool arguments stream in fragments, so a call is only reported once its message has finished. */
    function* finishedToolCalls(force = false): Generator<GatewayEvent> {
      for (const message of messages.values()) {
        if (!force && message.finishReason == null) {
          continue;
        }
        for (const call of message.toolCalls ?? []) {
          if (!reported.has(call.id)) {
            reported.add(call.id);
            yield {
              type: 'tool-call',
              threadId: message.threadId,
              deferred: call.function.name === 'call_tool',
              call: normalizeToolCall({
                id: call.id,
                functionName: call.function.name,
                argumentsJson: call.function.arguments,
                toolInfoName: call.toolInfo.name,
              }),
            };
          }
        }
      }
    }

    for await (const { data: event } of stream.withMetadata()) {
      if (isEventDelta(event)) {
        const base = messages.get(event.id);
        if (base) {
          mergeEventDelta(base, event);
        }
        if (typeof event.content === 'string' && event.content !== '') {
          yield { type: 'token', messageId: event.id, threadId: event.threadId, text: event.content };
        }
        yield* finishedToolCalls();
        continue;
      }
      switch (event.type) {
        case 'turn.created':
          yield { type: 'turn-started', turnId: event.turnId };
          break;
        case 'model.message': {
          messages.set(event.id, event);
          const text = textOf(event.content);
          if (text !== '') {
            yield { type: 'token', messageId: event.id, threadId: event.threadId, text };
          }
          yield* finishedToolCalls();
          break;
        }
        case 'tool.response':
          yield { type: 'tool-result', threadId: event.threadId, toolCallId: event.toolCallId, content: event.content };
          break;
        case 'tool.approval_required': {
          yield* finishedToolCalls(true);
          const pending: PendingApproval[] = event.toolCalls.map(ref => {
            const call = messages.get(ref.sourceEventId)?.toolCalls?.find(candidate => candidate.id === ref.id);
            return {
              threadId: event.threadId,
              call: call
                ? normalizeToolCall({
                    id: ref.id,
                    functionName: call.function.name,
                    argumentsJson: call.function.arguments,
                    toolInfoName: call.toolInfo.name,
                  })
                : { id: ref.id, name: 'unknown', args: {}, parseError: 'the harness did not stream this call' },
            };
          });
          yield { type: 'approval-required', pending };
          break;
        }
        case 'thread.created':
          yield { type: 'thread-started', threadId: event.threadId, title: event.title };
          break;
        case 'thread.done':
          yield {
            type: 'thread-finished',
            threadId: event.threadId,
            title: event.title,
            ...(event.state.status === 'error' ? { error: event.state.error } : {}),
          };
          break;
        case 'thread.context_compaction_started':
          yield { type: 'compaction', threadId: event.threadId, phase: 'started' };
          break;
        case 'thread.context_compaction_finished':
          yield { type: 'compaction', threadId: event.threadId, phase: 'finished' };
          break;
        case 'turn.done':
          yield* finishedToolCalls(true);
          yield { type: 'turn-done', outcome: toOutcome(event.state) };
          break;
        default:
          break;
      }
    }
  }
}
