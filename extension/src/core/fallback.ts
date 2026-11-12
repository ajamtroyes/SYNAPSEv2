export type FailureClass = 'auth' | 'transient';

/** Auth failures never heal on retry, so they skip straight to the next model. */
export function classifyFailure(message: string): FailureClass {
  return /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid.{0,20}(api.?key|token|credential)|incorrect api key|authentication/i.test(
    message,
  )
    ? 'auth'
    : 'transient';
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
