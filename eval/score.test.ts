import { describe, expect, it } from 'vitest';
import { evalCaseSchema } from './dataset.js';
import { aggregate, scoreCase, type ActualResult } from './score.js';

const caseOf = (overrides: Record<string, unknown>) =>
  evalCaseSchema.parse({
    id: 'T1',
    label: 'test case',
    expectedRisk: 'high',
    minimumAcceptableRisk: 'medium',
    ...overrides,
  });

const actual = (overrides: Partial<ActualResult> = {}): ActualResult => ({
  riskLevel: 'high',
  tags: [],
  entities: [],
  relationships: [],
  ...overrides,
});

describe('scoreCase', () => {
  it('gives a perfect score when everything matches', () => {
    const score = scoreCase(
      caseOf({
        requiredTagGroups: [['urgency', 'time-pressure']],
        requiredEntities: [{ type: 'person', matchAnyOf: ['harrington'] }],
        requiredRelationships: [{ sourceMatchAnyOf: ['harrington'], targetMatchAnyOf: ['arcline'] }],
      }),
      actual({
        tags: ['urgency'],
        entities: [{ type: 'person', displayName: 'James Harrington', canonicalKey: 'j harrington' }],
        relationships: [
          { source: 'James Harrington', target: 'Arcline', type: 'employed_by' },
        ],
      }),
    );

    expect(score.overall).toBe(1);
    expect(score.criticalMiss).toBe(false);
  });

  it('accepts any synonym within a tag group', () => {
    const score = scoreCase(
      caseOf({ requiredTagGroups: [['urgency', 'time-pressure']] }),
      actual({ tags: ['time-pressure'] }),
    );
    expect(score.tags.matched).toBe(1);
  });

  it('matches an entity on its canonical key when the display name differs', () => {
    const score = scoreCase(
      caseOf({ requiredEntities: [{ type: 'amount', matchAnyOf: ['184500'] }] }),
      actual({ entities: [{ type: 'amount', displayName: '$184,500', canonicalKey: '184500' }] }),
    );
    expect(score.entities.matched).toBe(1);
  });

  it('requires the entity type to agree', () => {
    const score = scoreCase(
      caseOf({ requiredEntities: [{ type: 'person', matchAnyOf: ['northgate'] }] }),
      actual({
        entities: [{ type: 'organization', displayName: 'Northgate', canonicalKey: 'northgate' }],
      }),
    );
    expect(score.entities.matched).toBe(0);
    expect(score.entities.missing).toEqual(['person:northgate']);
  });

  it('respects relationship direction', () => {
    const expected = caseOf({
      requiredRelationships: [{ sourceMatchAnyOf: ['dubois'], targetMatchAnyOf: ['pillai'] }],
    });
    const reversed = actual({
      relationships: [{ source: 'S. Pillai', target: 'K. Dubois', type: 'threatens' }],
    });
    expect(scoreCase(expected, reversed).relationships.matched).toBe(0);
  });

  it('flags a critical miss when a risky email scores below its floor', () => {
    const score = scoreCase(caseOf({}), actual({ riskLevel: 'low' }));
    expect(score.criticalMiss).toBe(true);
    expect(score.riskScore).toBe(0);
  });

  it('does not flag a near miss that still clears the floor', () => {
    const score = scoreCase(caseOf({}), actual({ riskLevel: 'medium' }));
    expect(score.criticalMiss).toBe(false);
    expect(score.riskScore).toBe(0.5);
  });

  it('zeroes the tag component when a forbidden tag appears', () => {
    const score = scoreCase(
      caseOf({ expectedRisk: 'none', minimumAcceptableRisk: undefined, forbiddenTags: ['fraud'] }),
      actual({ riskLevel: 'none', tags: ['fraud'] }),
    );

    expect(score.forbiddenTagsPresent).toEqual(['fraud']);
    // Risk was right, so the case is not zero overall — but tags are.
    expect(score.overall).toBeLessThan(1);
    expect(score.overall).toBeGreaterThan(0);
  });

  it('ignores components the case does not assert on', () => {
    const score = scoreCase(
      caseOf({ expectedRisk: 'none', minimumAcceptableRisk: undefined }),
      actual({ riskLevel: 'none' }),
    );
    expect(score.overall).toBe(1);
  });
});

describe('aggregate', () => {
  it('separates critical misses from the average', () => {
    const scores = [
      scoreCase(caseOf({ id: 'A' }), actual({ riskLevel: 'high' })),
      scoreCase(caseOf({ id: 'B' }), actual({ riskLevel: 'none' })),
    ];
    const result = aggregate(scores);

    expect(result.cases).toBe(2);
    expect(result.riskExact).toBe(1);
    expect(result.criticalMisses).toEqual(['B']);
    expect(result.riskScore).toBe(0.5);
  });

  it('reports recall pooled across cases, not averaged per case', () => {
    const scores = [
      scoreCase(
        caseOf({
          id: 'A',
          requiredEntities: [
            { type: 'person', matchAnyOf: ['a'] },
            { type: 'person', matchAnyOf: ['b'] },
          ],
        }),
        actual({ entities: [{ type: 'person', displayName: 'A', canonicalKey: 'a' }] }),
      ),
      scoreCase(
        caseOf({ id: 'B', requiredEntities: [{ type: 'person', matchAnyOf: ['c'] }] }),
        actual({ entities: [{ type: 'person', displayName: 'C', canonicalKey: 'c' }] }),
      ),
    ];

    // 2 of 3 required entities found overall.
    expect(aggregate(scores).entityRecall).toBeCloseTo(2 / 3);
  });

  it('handles an empty run without dividing by zero', () => {
    expect(aggregate([])).toMatchObject({ cases: 0, overall: 0, entityRecall: 1 });
  });
});

describe('attribution', () => {
  const withSources = (
    id: string,
    extraction: 'model' | 'rules',
    risk: 'model' | 'rules',
    level: 'high' | 'none' = 'high',
  ) =>
    scoreCase(caseOf({ id }), actual({ riskLevel: level, sources: { extraction, risk } }));

  it('counts a case as model-driven only when both agents used the model', () => {
    const result = aggregate([
      withSources('A', 'model', 'model'),
      withSources('B', 'model', 'rules'),
      withSources('C', 'rules', 'rules'),
    ]);

    expect(result.attribution.modelDriven).toBe(1);
    expect(result.attribution.fallbackAssisted).toBe(2);
  });

  it('separates the score the model earned from the score the fallback earned', () => {
    // One case the model got right; two the fallback got wrong.
    const result = aggregate([
      withSources('A', 'model', 'model', 'high'),
      withSources('B', 'rules', 'rules', 'none'),
      withSources('C', 'rules', 'rules', 'none'),
    ]);

    const { modelDrivenScore, fallbackAssistedScore } = result.attribution;
    expect(modelDrivenScore).toBe(1);
    expect(fallbackAssistedScore).toBeLessThan(modelDrivenScore!);

    // The blended figure sits between the two and reveals neither, which is
    // exactly why attribution is reported alongside it.
    expect(result.overall).toBeLessThan(modelDrivenScore!);
    expect(result.overall).toBeGreaterThan(fallbackAssistedScore!);
  });

  it('exposes the mistral case: every call failed, yet the blended score is high', () => {
    // All ten carried by the fallback, which happens to score well on this
    // corpus. The blended number looks like a good model; attribution does not.
    const scores = Array.from({ length: 10 }, (_, i) =>
      withSources(`E${i}`, 'rules', 'rules', 'high'),
    );
    const result = aggregate(scores);

    expect(result.overall).toBe(1);
    expect(result.attribution.modelDriven).toBe(0);
    expect(result.attribution.modelDrivenScore).toBeNull();
  });

  it('reports null rather than zero when a bucket is empty', () => {
    const result = aggregate([withSources('A', 'model', 'model')]);
    expect(result.attribution.fallbackAssisted).toBe(0);
    expect(result.attribution.fallbackAssistedScore).toBeNull();
  });

  it('treats a result with no recorded sources as rules', () => {
    const result = aggregate([scoreCase(caseOf({ id: 'A' }), actual())]);
    expect(result.attribution.modelDriven).toBe(0);
  });
});
