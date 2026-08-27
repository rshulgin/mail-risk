import { z } from 'zod';
import { extractedEntitySchema, extractedRelationshipSchema } from './entities.js';
import { riskLevelSchema, riskTagSchema } from './risk.js';

/**
 * The contracts the two agents must satisfy.
 *
 * These schemas do triple duty: they validate model output, they are converted
 * to JSON Schema to constrain the model up front (Ollama `format`, Gemini
 * `responseSchema`), and they type the API. Keeping them plain — no unions of
 * objects, no recursive types — is what makes that conversion clean.
 */

export const FACT_KINDS = ['amount', 'date', 'account', 'reference', 'other'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const extractedFactSchema = z.object({
  kind: z.enum(FACT_KINDS),
  value: z.string().min(1),
  context: z.string().default(''),
});
export type ExtractedFact = z.infer<typeof extractedFactSchema>;

/** Agent A — structure out of raw text. */
export const extractionResultSchema = z.object({
  sender: z.string().default(''),
  recipients: z.array(z.string()).default([]),
  date: z.string().default(''),
  subject: z.string().default(''),
  summary: z.string().default(''),
  facts: z.array(extractedFactSchema).default([]),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** Agent B — risk judgement plus the graph fragment for this email. */
export const riskGraphResultSchema = z.object({
  risk: z.object({
    level: riskLevelSchema,
    rationale: z.string().default(''),
    tags: z.array(riskTagSchema).default([]),
    confidence: z.number().min(0).max(1).default(0.5),
  }),
  entities: z.array(extractedEntitySchema).default([]),
  relationships: z.array(extractedRelationshipSchema).default([]),
});
export type RiskGraphResult = z.infer<typeof riskGraphResultSchema>;

export const AGENT_NAMES = ['extraction', 'risk_graph'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const RUN_STATUSES = ['running', 'completed', 'degraded', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const INVOCATION_STATUSES = ['ok', 'error', 'timeout', 'invalid_output'] as const;
export type InvocationStatus = (typeof INVOCATION_STATUSES)[number];

export const PROVIDER_NAMES = ['ollama', 'gemini', 'rules'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];
