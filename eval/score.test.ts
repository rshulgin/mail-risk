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
