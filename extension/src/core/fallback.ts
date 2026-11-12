export type FailureClass = 'auth' | 'transient';

/** Auth failures never heal on retry, so they skip straight to the next model. */
export function classifyFailure(message: string): FailureClass {
  return /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid.{0,20}(api.?key|token|credential)|incorrect api key|authentication/i.test(
    message,
  )
    ? 'auth'
    : 'transient';
}

/**
 * Says what went wrong in words a user can act on. The harness's own text, such as
 * "[Model Error] Cannot connect to API: connect ECONNREFUSED 127.0.0.1:19999", stays in the panel log.
 */
export function describeFailure(message: string, models: readonly string[]): string {
  const which = models.length === 1 ? `the model ${models[0] ?? ''}` : `any of the configured models (${models.join(', ')})`;
  if (classifyFailure(message) === 'auth') {
    return `The provider rejected the API key for ${which}. Check the key configured in TrueForge.`;
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|cannot connect|fetch failed|bad port|socket hang up/i.test(message)) {
    return `Could not reach ${which}. Check that the endpoint configured in TrueForge is running.`;
  }
  if (/\b429\b|rate.?limit|quota|overloaded/i.test(message)) {
    return `${models.length === 1 ? 'The model is' : 'Every configured model is'} rate-limited or overloaded. Try again shortly.`;
  }
  if (/terminal event|TrueForge/i.test(message)) {
    return `TrueForge stopped responding (${message}).`;
  }
  return `The model failed: ${message}`;
}

export type FallbackStep =
  | { action: 'retry'; model: string; attempt: number; delayMs: number }
  | { action: 'switch'; from: string; model: string }
  | { action: 'give-up'; tried: string[] };

export interface FallbackConfig {
  models: readonly string[];
  attemptsPerModel: number;
  backoffMs: number;
}

/**
 * TrueForge runs one model per agent and has no fallback of its own, so the chain lives in the
 * client. It only ever chooses among models configured in TrueForge: nothing here talks to a
 * provider, which is what keeps it inside the eligibility rule.
 */
export class FallbackPolicy {
  private index = 0;
  private attempt = 1;

  constructor(private readonly config: FallbackConfig) {
    if (config.models.length === 0) {
      throw new Error('No models configured. Set "synapse.models" to the models configured in TrueForge.');
    }
  }

  get currentModel(): string {
    return this.config.models[this.index] as string;
  }

  next(message: string): FallbackStep {
    if (classifyFailure(message) === 'transient' && this.attempt < this.config.attemptsPerModel) {
      const delayMs = this.config.backoffMs * 2 ** (this.attempt - 1);
      this.attempt += 1;
      return { action: 'retry', model: this.currentModel, attempt: this.attempt, delayMs };
    }
    const from = this.currentModel;
    if (this.index + 1 < this.config.models.length) {
      this.index += 1;
      this.attempt = 1;
      return { action: 'switch', from, model: this.currentModel };
    }
    return { action: 'give-up', tried: [...this.config.models] };
  }
}
