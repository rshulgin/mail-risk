import { LlmRequestError, LlmTimeoutError, type LlmProvider, type LlmRequest } from './provider.js';

/**
 * Scriptable provider for tests. Each entry is consumed by one call, so a
 * script expresses a sequence like "garbage, then valid" directly.
 */
export type FakeResponse =
  | { kind: 'text'; text: string }
  | { kind: 'json'; value: unknown }
  | { kind: 'timeout' }
  | { kind: 'error'; message?: string };

export function createFakeProvider(script: FakeResponse[]) {
  const calls: LlmRequest[] = [];
  let index = 0;

  const provider: LlmProvider = {
    name: 'ollama',
    model: 'fake-model',
    isAvailable: () => Promise.resolve(true),
    completeJson(request: LlmRequest) {
      calls.push(request);
      // Past the end of the script, keep returning the last instruction.
      const step = script[Math.min(index, script.length - 1)];
      index += 1;

      if (!step) return Promise.reject(new LlmRequestError('empty script'));
      switch (step.kind) {
        case 'timeout':
          return Promise.reject(new LlmTimeoutError(request.timeoutMs));
        case 'error':
          return Promise.reject(new LlmRequestError(step.message ?? 'provider exploded'));
        case 'json':
          return Promise.resolve(JSON.stringify(step.value));
        case 'text':
          return Promise.resolve(step.text);
      }
    },
  };

  return { provider, calls, callCount: () => index };
}

/** A minimal valid Agent A response. */
export const VALID_EXTRACTION = {
  sender: 'j.harrington-ceo@arclne-corp.com',
  recipients: ['finance-ops@arcline.com'],
  date: '2026-06-02T08:14:00Z',
  subject: 'URGENT - confidential wire needed before noon',
  summary: 'The sender asks Finance to wire $184,500 before noon.',
  facts: [{ kind: 'amount', value: '$184,500', context: 'requested wire' }],
};

/** A minimal valid Agent B response. */
export const VALID_RISK_GRAPH = {
  risk: {
    level: 'high',
    rationale: 'Urgency, secrecy and an out-of-band wire request.',
    tags: ['urgency', 'financial-anomaly'],
    confidence: 0.9,
  },
  entities: [
    { type: 'person', name: 'James Harrington', context: 'sender' },
    { type: 'amount', name: '$184,500', context: 'requested wire' },
  ],
  relationships: [
    {
      source: 'James Harrington',
      target: '$184,500',
      type: 'requests_transfer_of',
      evidence: 'asks Finance to wire the amount',
    },
  ],
};
