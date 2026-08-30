import { describe, expect, it } from 'vitest';
import { extractionResultSchema, riskGraphResultSchema } from '@mri/shared';
import { jsonSchemaFor, requireAllProperties } from './run-agent.js';

describe('requireAllProperties', () => {
  it('marks every declared property as required', () => {
    const result = requireAllProperties({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    }) as Record<string, unknown>;

    expect(result['required']).toEqual(['a', 'b']);
  });

  it('recurses into nested objects and array items', () => {
    const result = requireAllProperties({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { x: { type: 'string' } } },
        },
      },
    }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;

    expect(result['properties']?.['items']?.['items']?.['required']).toEqual(['x']);
  });

  it('leaves schemas without properties alone', () => {
    expect(requireAllProperties({ type: 'string' })).toEqual({ type: 'string' });
  });
});

describe('jsonSchemaFor', () => {
  it('requires the fields a grammar-constrained model would otherwise skip', () => {
    // Regression guard: these all carry `.default()`, so Zod emits them as
    // optional and Ollama returned only `risk.level` until this was fixed.
    const schema = jsonSchemaFor(riskGraphResultSchema) as {
      required: string[];
      properties: { risk: { required: string[] } };
    };

    expect(schema.required).toEqual(
      expect.arrayContaining(['risk', 'entities', 'relationships']),
    );
    expect(schema.properties.risk.required).toEqual(
      expect.arrayContaining(['level', 'rationale', 'tags']),
    );
  });

  it('requires the extraction fields too', () => {
    const schema = jsonSchemaFor(extractionResultSchema) as { required: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining(['sender', 'recipients', 'subject', 'summary', 'facts']),
    );
  });

  it('caches by schema instance', () => {
    expect(jsonSchemaFor(extractionResultSchema)).toBe(jsonSchemaFor(extractionResultSchema));
  });
});
