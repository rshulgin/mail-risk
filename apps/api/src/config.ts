import { env } from 'node:process';

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Single place where environment variables are read. Everything downstream
 * takes config as an argument, which keeps the pipeline testable.
 */
export const config = {
  port: int(env.PORT, 3001),
  databasePath: env.DATABASE_PATH ?? './data/mail-risk.db',
  llm: {
    provider: (env.LLM_PROVIDER ?? 'ollama') as 'ollama' | 'gemini' | 'rules',
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    ollamaModel: env.OLLAMA_MODEL ?? 'qwen2.5:3b',
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  },
  pipeline: {
    concurrency: int(env.PIPELINE_CONCURRENCY, 2),
    agentTimeoutMs: int(env.AGENT_TIMEOUT_MS, 60_000),
    agentMaxRetries: int(env.AGENT_MAX_RETRIES, 2),
  },
} as const;

export type Config = typeof config;
