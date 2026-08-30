import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { riskGraphResultSchema } from '@mri/shared';
import { toGeminiSchema } from './gemini.js';

describe('toGeminiSchema', () => {
  it('strips the keys Gemini rejects', () => {
    const cleaned = toGeminiSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: { name: { type: 'string', default: '' } },
    }) as Record<string, unknown>;

    expect(cleaned).not.toHaveProperty('$schema');
    expect(cleaned).not.toHaveProperty('additionalProperties');
    expect(JSON.stringify(cleaned)).not.toContain('default');
    expect(cleaned).toHaveProperty('type', 'object');
  });

  it('recurses into nested schemas and arrays', () => {
    const cleaned = toGeminiSchema({
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', additionalProperties: false } },
      },
    });
    expect(JSON.stringify(cleaned)).not.toContain('additionalProperties');
  });

  it('leaves the real agent schema usable, enums intact', () => {
    const generated = z.toJSONSchema(riskGraphResultSchema, { io: 'input' });
    const cleaned = JSON.stringify(toGeminiSchema(generated));

    expect(cleaned).not.toContain('$schema');
    expect(cleaned).toContain('"medium"');
    expect(cleaned).toContain('organization');
  });
});
