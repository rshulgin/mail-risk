import type { ZodType } from 'zod';

/**
 * Models return JSON with debris around it even when asked not to: markdown
 * fences, a "Here you go:" preamble, a trailing explanation. This module gets
 * from "probably contains JSON" to "validated domain object", or says why not.
 */

/** Strips markdown fences and any prose before the first brace. */
export function extractJsonCandidate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();

  const start = body.indexOf('{');
  if (start === -1) return null;

  // Walk to the matching brace, ignoring braces inside string literals so a
  // rationale containing "{" cannot truncate the object.
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i += 1) {
    const char = body[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }

  return null;
}

export type ParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'no_json' | 'malformed_json' | 'schema_violation'; detail: string };

/**
 * Parse and validate in one step. On failure the detail string is fed back to
 * the model on the retry, which turns most schema violations into a pass on
 * the second attempt.
 */
export function parseAgentJson<T>(raw: string, schema: ZodType<T>): ParseOutcome<T> {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) {
    return { ok: false, reason: 'no_json', detail: 'response contained no JSON object' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      ok: false,
      reason: 'malformed_json',
      detail: error instanceof Error ? error.message : 'invalid JSON',
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, reason: 'schema_violation', detail };
  }

  return { ok: true, value: result.data };
}
