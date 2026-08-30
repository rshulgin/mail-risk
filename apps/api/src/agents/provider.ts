import type { ProviderName } from '@mri/shared';

/**
 * A provider turns a prompt into raw text, constrained to a JSON Schema where
 * the backend supports it. It knows nothing about emails, risk or entities —
 * that is the agents' job — which keeps adding a provider to one small file.
 *
 * Note the deliberate absence of a "rules" provider here. Heuristics cannot
 * implement prompt-to-text in any honest way, so the deterministic fallback
 * lives at the agent layer instead (see `heuristics.ts`).
 */
export interface LlmRequest {
  system: string;
  prompt: string;
  /** JSON Schema the response must satisfy. */
  schema: Record<string, unknown>;
  schemaName: string;
  timeoutMs: number;
}

export interface LlmProvider {
  readonly name: Exclude<ProviderName, 'rules'>;
  readonly model: string;
  /** Cheap reachability check, used at boot to decide on the fallback. */
  isAvailable(): Promise<boolean>;
  completeJson(request: LlmRequest): Promise<string>;
}

/** Distinguishes "the model took too long" from "the model said something odd". */
export class LlmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`model call exceeded ${timeoutMs}ms`);
    this.name = 'LlmTimeoutError';
  }
}

export class LlmRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmRequestError';
  }
}
