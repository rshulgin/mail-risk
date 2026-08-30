import type { Config } from '../../config.js';
import type { LlmProvider } from '../provider.js';
import { createGeminiProvider } from './gemini.js';
import { createOllamaProvider } from './ollama.js';

export { createOllamaProvider } from './ollama.js';
export { createGeminiProvider, toGeminiSchema } from './gemini.js';

export interface ProviderResolution {
  provider: LlmProvider | null;
  /** What the operator asked for, which may differ from what they got. */
  requested: 'ollama' | 'gemini' | 'rules';
  /** Populated when we could not honour the request. */
  fallbackReason: string | null;
}

/** Builds the configured provider without contacting it. */
export function buildProvider(config: Config): LlmProvider | null {
  switch (config.llm.provider) {
    case 'gemini':
      return config.llm.geminiApiKey
        ? createGeminiProvider({
            apiKey: config.llm.geminiApiKey,
            model: config.llm.geminiModel,
          })
        : null;
    case 'rules':
      return null;
    case 'ollama':
    default:
      return createOllamaProvider({
        baseUrl: config.llm.ollamaBaseUrl,
        model: config.llm.ollamaModel,
      });
  }
}

/**
 * Picks the provider to run with, health-checking it first.
 *
 * An unreachable model degrades to heuristics instead of preventing start-up:
 * the reviewer running this without Ollama installed should still get a
 * working app, clearly labelled as running on rules.
 */
export async function resolveProvider(config: Config): Promise<ProviderResolution> {
  const requested = config.llm.provider;

  if (requested === 'rules') {
    return { provider: null, requested, fallbackReason: null };
  }

  if (requested === 'gemini' && !config.llm.geminiApiKey) {
    return {
      provider: null,
      requested,
      fallbackReason: 'GEMINI_API_KEY is not set',
    };
  }

  const provider = buildProvider(config);
  if (!provider) {
    return { provider: null, requested, fallbackReason: 'provider could not be constructed' };
  }

  const available = await provider.isAvailable();
  if (!available) {
    return {
      provider: null,
      requested,
      fallbackReason:
        requested === 'ollama'
          ? `Ollama is not reachable at ${config.llm.ollamaBaseUrl}`
          : 'Gemini is not reachable',
    };
  }

  return { provider, requested, fallbackReason: null };
}
