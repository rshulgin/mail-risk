import { z } from 'zod';
import type { AgentName, InvocationStatus } from '@mri/shared';
import type { ZodType } from 'zod';
import { parseAgentJson } from './json-repair.js';
import { buildRepairSuffix } from './prompts.js';
import { LlmTimeoutError, type LlmProvider } from './provider.js';

/**
 * The retry ladder shared by both agents.
 *
 * Failure modes are kept distinct because they call for different responses:
 * a timeout means back off, a schema violation means tell the model what was
 * wrong and ask again. Every attempt is reported to `onAttempt`, so the audit
 * trail records the failures as well as the eventual success.
 */

export interface AttemptReport {
  agent: AgentName;
  attempt: number;
  status: InvocationStatus;
  durationMs: number;
  error?: string;
  rawResponse?: string;
}

export interface RunAgentOptions<T> {
  agent: AgentName;
  provider: LlmProvider;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  timeoutMs: number;
  maxRetries: number;
  onAttempt(report: AttemptReport): void;
  /** Injectable so tests do not actually wait. */
  sleep?(ms: number): Promise<void>;
}

export type AgentOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: string; attempts: number };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Marks every declared property as required, recursively.
 *
 * This matters more than it looks. Zod emits any field with a `.default()` as
 * *optional*, and a grammar-constrained backend will happily satisfy such a
 * schema with the bare minimum — Ollama returned `{"risk":{"level":"high"}}`
 * and stopped, because `level` was the only required field in the whole
 * document. Defaults then quietly filled the rest with empty arrays, so the
 * pipeline reported plausible risk levels with no entities, no relationships
 * and no tags at all.
 *
 * So: strict in what we ask for, lenient in what we accept. The request demands
 * every field; the Zod schema still applies defaults if the model omits one.
 */
export function requireAllProperties(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(requireAllProperties);
  if (schema === null || typeof schema !== 'object') return schema;

  const source = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = requireAllProperties(value);
  }

  const properties = source['properties'];
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    result['required'] = Object.keys(properties as Record<string, unknown>);
  }

  return result;
}

/** Cached per schema object — JSON Schema generation is not free. */
const schemaCache = new WeakMap<object, Record<string, unknown>>();

export function jsonSchemaFor(schema: ZodType<unknown>): Record<string, unknown> {
  const cached = schemaCache.get(schema);
  if (cached) return cached;

  // `io: 'input'` describes what the model must send us. The output type
  // differs wherever a schema applies a transform (tags, relationship types),
  // and it is the input shape the model has to produce.
  const generated = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  const strict = requireAllProperties(generated) as Record<string, unknown>;
  schemaCache.set(schema, strict);
  return strict;
}

export async function runAgent<T>(options: RunAgentOptions<T>): Promise<AgentOutcome<T>> {
  const { agent, provider, schema, timeoutMs, maxRetries, onAttempt } = options;
  const sleep = options.sleep ?? defaultSleep;
  const jsonSchema = jsonSchemaFor(schema as ZodType<unknown>);

  let prompt = options.prompt;
  let lastError = 'agent did not run';

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const startedAt = Date.now();

    try {
      const raw = await provider.completeJson({
        system: options.system,
        prompt,
        schema: jsonSchema,
        schemaName: agent,
        timeoutMs,
      });

      const parsed = parseAgentJson(raw, schema);
      const durationMs = Date.now() - startedAt;

      if (parsed.ok) {
        onAttempt({ agent, attempt, status: 'ok', durationMs });
        return { ok: true, value: parsed.value, attempts: attempt };
      }

      lastError = `${parsed.reason}: ${parsed.detail}`;
      onAttempt({
        agent,
        attempt,
        status: 'invalid_output',
        durationMs,
        error: lastError,
        rawResponse: raw,
      });

      // Feed the specific complaint back in rather than retrying blind.
      prompt = options.prompt + buildRepairSuffix(parsed.detail);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const timedOut = error instanceof LlmTimeoutError;
      lastError = error instanceof Error ? error.message : 'unknown provider error';

      onAttempt({
        agent,
        attempt,
        status: timedOut ? 'timeout' : 'error',
        durationMs,
        error: lastError,
      });
    }

    if (attempt <= maxRetries) {
      await sleep(Math.min(2_000, 250 * 2 ** (attempt - 1)));
    }
  }

  return { ok: false, error: lastError, attempts: maxRetries + 1 };
}
