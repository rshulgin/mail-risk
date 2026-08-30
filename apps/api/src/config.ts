import { env } from 'node:process';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Repo root, derived from this file rather than from `process.cwd()`.
 *
 * npm runs a workspace script with the cwd set to that workspace, so
 * `npm start` and `npm run dev:api` would otherwise resolve a relative
 * DATABASE_PATH to different directories and quietly use different databases.
 */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Relative paths are anchored to the repo root; absolute paths are respected. */
export const resolveFromRoot = (path: string): string =>
  isAbsolute(path) ? path : resolve(REPO_ROOT, path);

/**
 * Single place where environment variables are read. Everything downstream
 * takes config as an argument, which keeps the pipeline testable.
 */
export const config = {
  port: int(env.PORT, 3001),
  databasePath: resolveFromRoot(env.DATABASE_PATH ?? './data/mail-risk.db'),
  seedPath: resolveFromRoot(env.SEED_PATH ?? './mock_mailbox_data.json'),
  llm: {
    provider: (env.LLM_PROVIDER ?? 'ollama') as 'ollama' | 'gemini' | 'rules',
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    ollamaModel: env.OLLAMA_MODEL ?? 'llama3.2:3b',
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  },
  pipeline: {
    // Domains treated as "inside the organisation". Drives the lookalike-domain
    // and personal-recipient heuristics.
    internalDomains: (env.INTERNAL_DOMAINS ?? 'arcline.com')
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
    concurrency: int(env.PIPELINE_CONCURRENCY, 2),
    agentTimeoutMs: int(env.AGENT_TIMEOUT_MS, 60_000),
    agentMaxRetries: int(env.AGENT_MAX_RETRIES, 2),
  },
} as const;

export type Config = typeof config;
