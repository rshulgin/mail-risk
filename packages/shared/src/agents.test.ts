import { describe, expect, it } from 'vitest';
import { extractionResultSchema, riskGraphResultSchema } from './agents.js';

describe('extraction schema', () => {
  it('fills in defaults for a sparse model response', () => {
    const parsed = extractionResultSchema.parse({ summary: 'A wire request.' });
    expect(parsed.facts).toEqual([]);
    expect(parsed.recipients).toEqual([]);
  });

  it('drops keys the model invented', () => {
    const parsed = extractionResultSchema.parse({
      summary: 'x',
      hallucinated_field: 'should not survive',
    });
    expect(parsed).not.toHaveProperty('hallucinated_field');
  });

  it('rejects a fact with no value', () => {
    const result = extractionResultSchema.safeParse({
      facts: [{ kind: 'amount', value: '' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('risk + graph schema', () => {
  it('normalises tags and relationship types on the way in', () => {
    const parsed = riskGraphResultSchema.parse({
      risk: { level: 'high', rationale: 'Wire fraud.', tags: ['Financial Anomaly'] },
      entities: [{ type: 'person', name: 'James Harrington' }],
      relationships: [
        { source: 'James Harrington', target: 'Escrow Partner', type: 'Requests Transfer To' },
      ],
    });

    expect(parsed.risk.tags).toEqual(['financial-anomaly']);
    expect(parsed.relationships[0]?.type).toBe('requests_transfer_to');
    expect(parsed.risk.confidence).toBe(0.5);
  });

  it('rejects a risk level outside the taxonomy', () => {
    const result = riskGraphResultSchema.safeParse({
      risk: { level: 'catastrophic', rationale: 'x' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an entity type outside the taxonomy', () => {
    const result = riskGraphResultSchema.safeParse({
      risk: { level: 'low', rationale: 'x' },
      entities: [{ type: 'spaceship', name: 'x' }],
    });
    expect(result.success).toBe(false);
  });
});
