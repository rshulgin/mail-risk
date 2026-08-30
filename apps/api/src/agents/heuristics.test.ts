import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  rawEmailSchema,
  seedCorpusSchema,
  seedEmailToRawEmail,
  type RawEmail,
  type RiskLevel,
} from '@mri/shared';
import { config } from '../config.js';
import { heuristicExtraction, heuristicRiskGraph, isLookalikeDomain } from './heuristics.js';

const corpus = seedCorpusSchema.parse(JSON.parse(readFileSync(config.seedPath, 'utf8')));

const byId = new Map(corpus.emails.map((seed) => [seed.id, seedEmailToRawEmail(seed)]));

const assess = (email: RawEmail) => heuristicRiskGraph(email, heuristicExtraction(email));

describe('lookalike domain detection', () => {
  const internal = ['arcline.com'];

  it('catches the typosquats in the corpus', () => {
    expect(isLookalikeDomain('arclne-corp.com', internal)).toBe(true);
    expect(isLookalikeDomain('arclline-portal.com', internal)).toBe(true);
  });

  it('does not flag the real domain or an unrelated one', () => {
    expect(isLookalikeDomain('arcline.com', internal)).toBe(false);
    expect(isLookalikeDomain('northgate-suppliers.com', internal)).toBe(false);
    expect(isLookalikeDomain('partnerlogistics.com', internal)).toBe(false);
  });
});

describe('heuristic extraction', () => {
  it('pulls amounts and accounts out of attachment text, not just the body', () => {
    const email = byId.get('E004')!;
    const facts = heuristicExtraction(email).facts;

    expect(facts.some((f) => f.kind === 'amount' && f.value.includes('47,300'))).toBe(true);
    // 9902 appears only in the attachment.
    expect(facts.some((f) => f.kind === 'account' && f.value === '9902')).toBe(true);
    expect(facts.some((f) => f.kind === 'reference' && f.value.includes('4471'))).toBe(true);
  });

  it('does not capture a sentence comma as part of an amount', () => {
    // E004 body: "invoice #NS-4471 for $47,300, due in 10 days"
    const facts = heuristicExtraction(byId.get('E004')!).facts;
    const amounts = facts.filter((f) => f.kind === 'amount').map((f) => f.value);

    expect(amounts.every((value) => !value.endsWith(','))).toBe(true);
    expect(amounts.some((value) => value === '$47,300')).toBe(true);
  });

  it('summarises without inventing content', () => {
    const email = byId.get('E002')!;
    const { summary } = heuristicExtraction(email);
    expect(email.body).toContain(summary.replace(/…$/, '').slice(0, 40));
  });

  it('survives a completely empty email', () => {
    const empty = rawEmailSchema.parse({});
    const extraction = heuristicExtraction(empty);
    expect(extraction.facts).toEqual([]);
    expect(() => heuristicRiskGraph(empty, extraction)).not.toThrow();
  });
});

describe('heuristic risk levels across the seed corpus', () => {
  // Pinned so a change to the signal table cannot silently regress the corpus.
  const expectations: Record<string, RiskLevel> = {
    E001: 'high',   // CEO fraud
    E002: 'none',   // IT maintenance
    E003: 'high',   // insider exfiltration
    E004: 'high',   // invoice redirect
    E005: 'high',   // MNPI tip
    E006: 'high',   // threat
    E007: 'none',   // HR holiday
    E008: 'high',   // phishing
    E009: 'none',   // legitimate invoice
    E010: 'medium', // whistleblower report
  };

  for (const [id, expectedLevel] of Object.entries(expectations)) {
    it(`${id} scores ${expectedLevel}`, () => {
      expect(assess(byId.get(id)!).risk.level).toBe(expectedLevel);
    });
  }

  it('keeps the legitimate invoice clean while flagging the redirected one', () => {
    const legit = assess(byId.get('E009')!);
    const redirect = assess(byId.get('E004')!);

    expect(legit.risk.tags).not.toContain('payment-redirect');
    expect(redirect.risk.tags).toContain('payment-redirect');
  });

  it('never claims model-level confidence', () => {
    for (const email of byId.values()) {
      expect(assess(email).risk.confidence).toBeLessThanOrEqual(0.7);
    }
  });
});

describe('heuristic graph fragment', () => {
  it('names the sender, the counterparty domain and the amount', () => {
    const result = assess(byId.get('E001')!);
    const names = result.entities.map((e) => e.name.toLowerCase());

    expect(names.some((n) => n.includes('harrington'))).toBe(true);
    expect(names).toContain('arcline.com');
    expect(result.entities.some((e) => e.type === 'amount' && e.name.includes('184,500'))).toBe(true);
  });

  it('does not turn a functional mailbox into a person', () => {
    const result = assess(byId.get('E001')!);
    const people = result.entities.filter((e) => e.type === 'person').map((e) => e.name);
    expect(people.some((name) => name.startsWith('finance-ops'))).toBe(false);
  });

  it('links sender to recipient', () => {
    const result = assess(byId.get('E005')!);
    expect(result.relationships.some((r) => r.type === 'sends_to')).toBe(true);
  });
});
