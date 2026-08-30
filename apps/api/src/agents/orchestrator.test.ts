import { beforeEach, describe, expect, it } from 'vitest';
import { rawEmailSchema, type RawEmail } from '@mri/shared';
import { createStorage, type Storage } from '../storage/index.js';
import { createOrchestrator } from './orchestrator.js';
import {
  createFakeProvider,
  VALID_EXTRACTION,
  VALID_RISK_GRAPH,
  type FakeResponse,
} from './fake-provider.js';

const EMAIL: RawEmail = rawEmailSchema.parse({
  externalId: 'E001',
  from: 'j.harrington-ceo@arclne-corp.com',
  to: ['finance-ops@arcline.com'],
  date: '2026-06-02T08:14:00Z',
  subject: 'URGENT - confidential wire needed before noon',
  body: "I need Finance to wire $184,500 to our new escrow partner today before 12pm. Please treat this as confidential and don't loop in anyone else.",
});

/** Tests must not actually sleep through the backoff. */
const noSleep = () => Promise.resolve();

describe('orchestrator', () => {
  let storage: Storage;
  let emailId: string;

  beforeEach(() => {
    storage = createStorage(':memory:');
    emailId = storage.emails.insert({ email: EMAIL, rawText: EMAIL.body, source: 'seed' }).id;
  });

  const orchestrate = (script: FakeResponse[], maxRetries = 2) => {
    const fake = createFakeProvider(script);
    return {
      fake,
      orchestrator: createOrchestrator({
        storage,
        provider: fake.provider,
        timeoutMs: 1_000,
        maxRetries,
        sleep: noSleep,
      }),
    };
  };

  describe('happy path', () => {
    it('chains both agents and persists the whole result', async () => {
      const { orchestrator } = orchestrate([
        { kind: 'json', value: VALID_EXTRACTION },
        { kind: 'json', value: VALID_RISK_GRAPH },
      ]);

      const outcome = await orchestrator.process(emailId);

      expect(outcome).toMatchObject({
        status: 'completed',
        riskLevel: 'high',
        extractionSource: 'model',
        riskSource: 'model',
        entityCount: 2,
        relationshipCount: 1,
      });
      expect(storage.emails.get(emailId)?.status).toBe('completed');

      const [listed] = storage.emails.list();
      expect(listed?.riskLevel).toBe('high');
      expect(listed?.summary).toContain('$184,500');
      expect(storage.graph.getEmailGraph(emailId).entities).toHaveLength(2);
    });

    it('passes Agent A output into Agent B prompt', async () => {
      const { fake, orchestrator } = orchestrate([
        { kind: 'json', value: VALID_EXTRACTION },
        { kind: 'json', value: VALID_RISK_GRAPH },
      ]);

      await orchestrator.process(emailId);

      expect(fake.calls).toHaveLength(2);
      expect(fake.calls[1]?.prompt).toContain('STRUCTURED EXTRACTION');
      expect(fake.calls[1]?.prompt).toContain(VALID_EXTRACTION.summary);
    });

    it('constrains generation with a JSON schema', async () => {
      const { fake, orchestrator } = orchestrate([
        { kind: 'json', value: VALID_EXTRACTION },
        { kind: 'json', value: VALID_RISK_GRAPH },
      ]);

      await orchestrator.process(emailId);
      expect(fake.calls[0]?.schema).toMatchObject({ type: 'object' });
      expect(JSON.stringify(fake.calls[1]?.schema)).toContain('"medium"');
    });
  });

  describe('recoverable failures', () => {
    it('retries after unparseable output and succeeds', async () => {
      const { fake, orchestrator } = orchestrate([
        { kind: 'text', text: 'Sure! Let me think about this...' },
        { kind: 'json', value: VALID_EXTRACTION },
        { kind: 'json', value: VALID_RISK_GRAPH },
      ]);

      const outcome = await orchestrator.process(emailId);

      expect(outcome?.status).toBe('completed');
      expect(outcome?.extractionSource).toBe('model');
      expect(fake.calls[1]?.prompt).toContain('Your previous response was rejected');
    });

    it('tells the model what was wrong after a schema violation', async () => {
      const { fake, orchestrator } = orchestrate([
        { kind: 'json', value: VALID_EXTRACTION },
        { kind: 'json', value: { risk: { level: 'catastrophic', rationale: 'x' } } },
        { kind: 'json', value: VALID_RISK_GRAPH },
      ]);

      const outcome = await orchestrator.process(emailId);

      expect(outcome?.riskSource).toBe('model');
      expect(fake.calls[2]?.prompt).toContain('risk.level');
    });

    it('recovers from a transient timeout', async () => {
      const { orchestrator } = orchestrate([
        { kind: 'timeout' },
        { kind: 'json', value: VALID_EXTRACTION },
        { kind: 'json', value: VALID_RISK_GRAPH },
      ]);

      expect((await orchestrator.process(emailId))?.status).toBe('completed');
    });
  });

  describe('degradation ladder', () => {
    it('falls back to rules when the risk agent never returns valid output', async () => {
      const { orchestrator } = orchestrate([
        { kind: 'json', value: VALID_EXTRACTION },
        { kind: 'text', text: 'nope' },
        { kind: 'text', text: 'still nope' },
        { kind: 'text', text: 'nope again' },
      ]);

      const outcome = await orchestrator.process(emailId);

      expect(outcome?.status).toBe('degraded');
      expect(outcome?.extractionSource).toBe('model');
      expect(outcome?.riskSource).toBe('rules');
      // The heuristics still catch this email.
      expect(outcome?.riskLevel).toBe('high');
      expect(outcome?.degradedReason).toContain('risk agent fell back to rules');
      expect(storage.emails.get(emailId)?.status).toBe('degraded');
    });

    it('degrades both agents when the provider is entirely down', async () => {
      const { orchestrator } = orchestrate([{ kind: 'error', message: 'ECONNREFUSED' }]);

      const outcome = await orchestrator.process(emailId);

      expect(outcome?.status).toBe('degraded');
      expect(outcome?.extractionSource).toBe('rules');
      expect(outcome?.riskSource).toBe('rules');
      expect(outcome?.riskLevel).toBe('high');
      // Still produces a usable assessment rather than an error state.
      expect(storage.emails.list()[0]?.riskLevel).toBe('high');
    });

    it('stops retrying once the budget is spent', async () => {
      const { fake, orchestrator } = orchestrate([{ kind: 'timeout' }], 1);

      await orchestrator.process(emailId);

      // 2 attempts per agent (1 try + 1 retry), two agents.
      expect(fake.callCount()).toBe(4);
    });

    it('records every attempt, failures included, in the audit trail', async () => {
      const { orchestrator } = orchestrate([
        { kind: 'text', text: 'garbage' },
        { kind: 'json', value: VALID_EXTRACTION },
        { kind: 'json', value: VALID_RISK_GRAPH },
      ]);

      const outcome = await orchestrator.process(emailId);
      const invocations = storage.runs.listInvocations(outcome!.runId);

      expect(invocations.map((i) => `${i.agent}:${i.status}`)).toEqual([
        'extraction:invalid_output',
        'extraction:ok',
        'risk_graph:ok',
      ]);
      expect(invocations[0]?.rawResponse).toBe('garbage');
      expect(invocations[0]?.error).toContain('no_json');
    });
  });

  describe('no provider configured', () => {
    it('runs on rules alone and reports completed, not degraded', async () => {
      const orchestrator = createOrchestrator({
        storage,
        provider: null,
        timeoutMs: 1_000,
        maxRetries: 2,
        sleep: noSleep,
      });

      const outcome = await orchestrator.process(emailId);

      expect(outcome).toMatchObject({
        status: 'completed',
        riskSource: 'rules',
        riskLevel: 'high',
      });
      expect(orchestrator.providerName).toBe('rules');
      expect(storage.runs.get(outcome!.runId)?.provider).toBe('rules');
    });
  });

  describe('reprocessing', () => {
    it('replaces the previous graph fragment and keeps both runs', async () => {
      const first = orchestrate([
        { kind: 'json', value: VALID_EXTRACTION },
        { kind: 'json', value: VALID_RISK_GRAPH },
      ]);
      await first.orchestrator.process(emailId);

      const second = orchestrate([
        { kind: 'json', value: VALID_EXTRACTION },
        {
          kind: 'json',
          value: {
            ...VALID_RISK_GRAPH,
            risk: { ...VALID_RISK_GRAPH.risk, level: 'medium' },
            entities: [{ type: 'organization', name: 'Arcline', context: 'employer' }],
            relationships: [],
          },
        },
      ]);
      await second.orchestrator.process(emailId);

      expect(storage.runs.listForEmail(emailId)).toHaveLength(2);
      expect(storage.emails.list()[0]?.riskLevel).toBe('medium');
      expect(
        storage.graph.getEmailGraph(emailId).entities.map((e) => e.displayName),
      ).toEqual(['Arcline']);
    });
  });

  describe('unknown email', () => {
    it('returns null rather than throwing', async () => {
      const { orchestrator } = orchestrate([{ kind: 'json', value: VALID_EXTRACTION }]);
      expect(await orchestrator.process('does-not-exist')).toBeNull();
    });
  });
});
