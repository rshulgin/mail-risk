import { beforeEach, describe, expect, it } from 'vitest';
import { rawEmailSchema, type RawEmail } from '@mri/shared';
import { createStorage, type Storage } from '../storage/index.js';
import { createOrchestrator, priorContextCandidates } from './orchestrator.js';
import { renderPriorContext } from './prompts.js';
import { createFakeProvider, VALID_EXTRACTION } from './fake-provider.js';

/**
 * The cross-email memory: E009 establishes which account Northgate is paid to,
 * and E004 then arrives claiming a different one. No single email carries that
 * signal — it only exists in the history.
 */

const LEGIT_INVOICE: RawEmail = rawEmailSchema.parse({
  externalId: 'E009',
  from: 'billing@northgate-suppliers.com',
  to: ['accounts-payable@arcline.com'],
  date: '2026-05-04T11:00:00Z',
  subject: 'Invoice #NS-4188 - payment due',
  body: 'Please find attached our monthly invoice. Terms net 15 as usual.',
  attachments: [
    {
      filename: 'invoice_NS-4188.pdf',
      extractedText: 'Invoice #NS-4188. Amount due: $13,900.00. Payment account: account ending 6621.',
    },
  ],
});

const REDIRECTED_INVOICE: RawEmail = rawEmailSchema.parse({
  externalId: 'E004',
  from: 'billing@northgate-suppliers.com',
  to: ['accounts-payable@arcline.com'],
  date: '2026-06-04T11:20:00Z',
  subject: 'Invoice #NS-4471 - please note updated payment details',
  body: "We've changed banking providers - please use the new account details going forward.",
  attachments: [
    {
      filename: 'invoice_NS-4471.pdf',
      extractedText: 'Invoice #NS-4471. Amount due: $47,300.00. New payment account: account ending 9902.',
    },
  ],
});

describe('priorContextCandidates', () => {
  it('covers the parties on the envelope and their domains', () => {
    const candidates = priorContextCandidates(REDIRECTED_INVOICE, {
      ...VALID_EXTRACTION,
      facts: [],
    });

    expect(candidates).toContainEqual({
      type: 'organization',
      name: 'northgate-suppliers.com',
    });
    expect(candidates).toContainEqual({
      type: 'person',
      name: 'billing@northgate-suppliers.com',
    });
  });

  it('includes account numbers but not amounts', () => {
    const candidates = priorContextCandidates(REDIRECTED_INVOICE, {
      ...VALID_EXTRACTION,
      facts: [
        { kind: 'account', value: '9902', context: '' },
        { kind: 'amount', value: '$47,300', context: '' },
      ],
    });

    expect(candidates).toContainEqual({ type: 'account', name: '9902' });
    // Two emails sharing a figure is usually coincidence, not a connection.
    expect(candidates.some((c) => c.type === 'amount')).toBe(false);
  });
});

describe('renderPriorContext', () => {
  it('is empty when nothing is known, so the prompt gains no dead section', () => {
    expect(renderPriorContext([])).toBe('');
  });

  it('states the history and the previous links in readable prose', () => {
    const rendered = renderPriorContext([
      {
        id: 'x',
        type: 'organization',
        name: 'northgate-suppliers.com',
        canonicalKey: 'northgate suppliers',
        emailCount: 1,
        lastSeenAt: '2026-05-04T11:00:00Z',
        highestRisk: 'none',
        related: [
          { type: 'account', name: '6621', relationship: 'holds_account', direction: 'outgoing' },
        ],
      },
    ]);

    expect(rendered).toContain('PRIOR CONTEXT');
    expect(rendered).toContain('seen in 1 earlier email');
    expect(rendered).toContain('2026-05-04');
    expect(rendered).toContain('account "6621"');
    expect(rendered).toContain('holds account');
  });
});

describe('cross-email context through the pipeline', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = createStorage(':memory:');
  });

  /** Runs one email with a scripted Agent B response, returning the prompts used. */
  const run = async (email: RawEmail, riskGraph: unknown) => {
    const record = storage.emails.insert({ email, rawText: email.body, source: 'seed' });
    const fake = createFakeProvider([
      { kind: 'json', value: { ...VALID_EXTRACTION, facts: [] } },
      { kind: 'json', value: riskGraph },
    ]);
    const orchestrator = createOrchestrator({
      storage,
      provider: fake.provider,
      timeoutMs: 1_000,
      maxRetries: 0,
      sleep: () => Promise.resolve(),
    });

    const outcome = await orchestrator.process(record.id);
    return { outcome, riskPrompt: fake.calls[1]?.prompt ?? '' };
  };

  const northgateGraph = (account: string) => ({
    risk: { level: 'none', rationale: 'Routine invoice.', tags: [], confidence: 0.8 },
    entities: [
      { type: 'organization', name: 'northgate-suppliers.com', context: 'vendor' },
      { type: 'account', name: account, context: 'payment account' },
    ],
    relationships: [
      {
        source: 'northgate-suppliers.com',
        target: account,
        type: 'holds_account',
        evidence: 'named on the invoice',
      },
    ],
  });

  it('gives the first email no history to work from', async () => {
    const { outcome, riskPrompt } = await run(LEGIT_INVOICE, northgateGraph('6621'));

    expect(outcome?.priorContextCount).toBe(0);
    expect(riskPrompt).not.toContain('PRIOR CONTEXT');
  });

  it('tells the second email which account the vendor used before', async () => {
    await run(LEGIT_INVOICE, northgateGraph('6621'));
    const { outcome, riskPrompt } = await run(REDIRECTED_INVOICE, northgateGraph('9902'));

    expect(outcome!.priorContextCount).toBeGreaterThan(0);
    expect(riskPrompt).toContain('PRIOR CONTEXT');
    expect(riskPrompt).toContain('northgate-suppliers.com');
    // The decisive fact: the account on file, which E004 alone cannot reveal.
    expect(riskPrompt).toContain('6621');
  });

  it('does not feed an email its own history when reprocessing', async () => {
    const record = storage.emails.insert({
      email: LEGIT_INVOICE,
      rawText: LEGIT_INVOICE.body,
      source: 'seed',
    });

    const build = () =>
      createFakeProvider([
        { kind: 'json', value: { ...VALID_EXTRACTION, facts: [] } },
        { kind: 'json', value: northgateGraph('6621') },
      ]);

    const first = build();
    await createOrchestrator({
      storage,
      provider: first.provider,
      timeoutMs: 1_000,
      maxRetries: 0,
      sleep: () => Promise.resolve(),
    }).process(record.id);

    const second = build();
    const outcome = await createOrchestrator({
      storage,
      provider: second.provider,
      timeoutMs: 1_000,
      maxRetries: 0,
      sleep: () => Promise.resolve(),
    }).process(record.id);

    expect(outcome?.priorContextCount).toBe(0);
    expect(second.calls[1]?.prompt).not.toContain('PRIOR CONTEXT');
  });

  it('carries forward the risk an entity was previously seen with', async () => {
    await run(LEGIT_INVOICE, {
      ...northgateGraph('6621'),
      risk: { level: 'high', rationale: 'Suspicious.', tags: ['fraud'], confidence: 0.9 },
    });

    const { riskPrompt } = await run(REDIRECTED_INVOICE, northgateGraph('9902'));
    expect(riskPrompt).toContain('highest risk so far: high');
  });
});
