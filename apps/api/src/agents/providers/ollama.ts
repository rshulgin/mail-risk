import {
  LlmRequestError,
  LlmTimeoutError,
  type LlmProvider,
  type LlmRequest,
} from '../provider.js';

/** Fixed so repeated runs are comparable. Any constant would do. */
const OLLAMA_SEED = 42;

interface OllamaChatResponse {
  message?: { content?: string };
}

/**
 * Local model via Ollama — the default, because it needs no key, no network
 * egress and no quota.
 *
 * Ollama accepts a JSON Schema in `format`, which constrains generation rather
 * than merely requesting JSON politely. That removes most malformed-output
 * failures at the source, so the retry ladder above is a safety net rather
 * than the primary mechanism.
 */
export function createOllamaProvider(options: {
  baseUrl: string;
  model: string;
}): LlmProvider {
  const { baseUrl, model } = options;

  return {
    name: 'ollama',
    model,

    async isAvailable() {
      try {
        const response = await fetch(new URL('/api/tags', baseUrl), {
          signal: AbortSignal.timeout(2_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async completeJson(request: LlmRequest) {
      let response: Response;
      try {
        response = await fetch(new URL('/api/chat', baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(request.timeoutMs),
          body: JSON.stringify({
            model,
            stream: false,
            format: request.schema,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.prompt },
            ],
            options: {
              // This is a classification task, not a creative one.
              temperature: 0,
              // temperature 0 alone is *not* reproducible: sampling still
              // varies run to run, and two eval runs of the same corpus
              // disagreed by 40 points on individual emails. A fixed seed
              // makes the eval a regression gate rather than a weather report.
              seed: OLLAMA_SEED,
              num_ctx: 8192,
            },
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new LlmTimeoutError(request.timeoutMs);
        }
        throw new LlmRequestError(
          error instanceof Error ? error.message : 'ollama request failed',
        );
      }

      if (!response.ok) {
        throw new LlmRequestError(`ollama returned ${response.status} ${response.statusText}`);
      }

      const body = (await response.json()) as OllamaChatResponse;
      const content = body.message?.content;
      if (typeof content !== 'string') {
        throw new LlmRequestError('ollama response had no message content');
      }
      return content;
    },
  };
}
