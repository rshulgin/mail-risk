import {
  LlmRequestError,
  LlmTimeoutError,
  type LlmProvider,
  type LlmRequest,
} from '../provider.js';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

/**
 * Gemini's `responseSchema` is a subset of OpenAPI 3.0, not full JSON Schema:
 * it rejects `$schema`, `additionalProperties`, `default` and `const`. Rather
 * than maintain a second hand-written schema per agent, we generate one from
 * Zod and strip the keys Gemini will not accept.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;

  const unsupported = new Set([
    '$schema',
    'additionalProperties',
    'default',
    'const',
    'exclusiveMinimum',
    'exclusiveMaximum',
    '$ref',
    'definitions',
    '$defs',
  ]);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (unsupported.has(key)) continue;
    result[key] = toGeminiSchema(value);
  }
  return result;
}

export function createGeminiProvider(options: {
  apiKey: string;
  model: string;
}): LlmProvider {
  const { apiKey, model } = options;
  const endpoint = (method: string) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;

  return {
    name: 'gemini',
    model,

    async isAvailable() {
      if (!apiKey) return false;
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}`,
          { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(4_000) },
        );
        return response.ok;
      } catch {
        return false;
      }
    },

    async completeJson(request: LlmRequest) {
      let response: Response;
      try {
        response = await fetch(endpoint('generateContent'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(request.timeoutMs),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: toGeminiSchema(request.schema),
            },
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new LlmTimeoutError(request.timeoutMs);
        }
        throw new LlmRequestError(
          error instanceof Error ? error.message : 'gemini request failed',
        );
      }

      const body = (await response.json()) as GeminiResponse;
      if (!response.ok) {
        throw new LlmRequestError(
          body.error?.message ?? `gemini returned ${response.status} ${response.statusText}`,
        );
      }

      const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        throw new LlmRequestError('gemini response had no text part');
      }
      return text;
    },
  };
}
