import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJsonCandidate, parseAgentJson } from './json-repair.js';

const schema = z.object({ level: z.enum(['low', 'high']), note: z.string().default('') });

describe('extractJsonCandidate', () => {
  it('takes plain JSON as-is', () => {
    expect(extractJsonCandidate('{"a":1}')).toBe('{"a":1}');
  });

  it('unwraps a markdown fence', () => {
    expect(extractJsonCandidate('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonCandidate('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('discards a chatty preamble and trailing commentary', () => {
    const raw = 'Sure! Here is the JSON:\n{"a":1}\nLet me know if you need anything else.';
    expect(extractJsonCandidate(raw)).toBe('{"a":1}');
  });

  it('does not truncate on a brace inside a string', () => {
    const raw = '{"rationale":"uses a { character","level":"high"}';
    expect(extractJsonCandidate(raw)).toBe(raw);
  });

  it('handles an escaped quote before a brace', () => {
    const raw = '{"note":"he said \\"go {\\" loudly","ok":true}';
    expect(extractJsonCandidate(raw)).toBe(raw);
  });

  it('keeps nested objects intact', () => {
    const raw = '{"risk":{"level":"high"},"n":1}';
    expect(extractJsonCandidate(raw)).toBe(raw);
  });

  it('returns null when there is no object at all', () => {
    expect(extractJsonCandidate('I cannot help with that.')).toBeNull();
    expect(extractJsonCandidate('')).toBeNull();
  });

  it('returns null on an unterminated object', () => {
    expect(extractJsonCandidate('{"a":1')).toBeNull();
  });
});

describe('parseAgentJson', () => {
  it('parses and applies schema defaults', () => {
    const result = parseAgentJson('```json\n{"level":"high"}\n```', schema);
    expect(result).toEqual({ ok: true, value: { level: 'high', note: '' } });
  });

  it('reports no_json when the model refused', () => {
    const result = parseAgentJson('I am unable to assess this email.', schema);
    expect(result).toMatchObject({ ok: false, reason: 'no_json' });
  });

  it('reports malformed_json on a truncated object', () => {
    const result = parseAgentJson('{"level":"high",}', schema);
    expect(result).toMatchObject({ ok: false, reason: 'malformed_json' });
  });

  it('reports schema_violation with a detail usable as a repair hint', () => {
    const result = parseAgentJson('{"level":"catastrophic"}', schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('schema_violation');
      expect(result.detail).toContain('level');
    }
  });
});
