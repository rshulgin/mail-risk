import {
  extractionResultSchema,
  riskGraphResultSchema,
  type ExtractionResult,
  type ProviderName,
  type RawEmail,
  type RiskGraphResult,
  type RunStatus,
} from '@mri/shared';
import type { Storage } from '../storage/index.js';
import { heuristicExtraction, heuristicRiskGraph } from './heuristics.js';
import {
  EXTRACTION_SYSTEM_PROMPT,
  RISK_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildRiskPrompt,
} from './prompts.js';
import type { LlmProvider } from './provider.js';
import { runAgent, type AttemptReport } from './run-agent.js';

/**
 * Chains Agent A into Agent B and persists the result.
 *
 * The controlling idea is a degradation ladder rather than a success/failure
 * switch. Each agent independently tries the model, and falls back to the
 * deterministic heuristics if the model cannot produce valid output. An email
 * therefore always ends up with *some* assessment, and the run record says
 * exactly how it was reached — which is the honest version of "don't let the
 * whole app break".
 */

export interface OrchestratorOptions {
  storage: Storage;
  /** Absent when running with LLM_PROVIDER=rules, or when nothing is reachable. */
  provider: LlmProvider | null;
  timeoutMs: number;
  maxRetries: number;
  /** Domains treated as internal by the heuristic fallback. */
  internalDomains?: readonly string[];
  sleep?(ms: number): Promise<void>;
}

export interface RunOutcome {
  emailId: string;
  runId: string;
  status: RunStatus;
  riskLevel: string;
  degradedReason: string | null;
  extractionSource: 'model' | 'rules';
  riskSource: 'model' | 'rules';
  entityCount: number;
  relationshipCount: number;
}

export function createOrchestrator(options: OrchestratorOptions) {
  const { storage, provider, timeoutMs, maxRetries } = options;
  const heuristicOptions = { internalDomains: options.internalDomains ?? ['arcline.com'] };

  const providerName: ProviderName = provider?.name ?? 'rules';
  const modelName = provider?.model ?? 'heuristic-v1';

  return {
    providerName,
    modelName,

    async process(emailId: string): Promise<RunOutcome | null> {
      const record = storage.emails.get(emailId);
      if (!record) return null;

      const email: RawEmail = {
        externalId: record.externalId ?? undefined,
        from: record.from,
        to: record.to,
        date: record.sentAt ?? '',
        subject: record.subject,
        body: record.rawText,
        attachments: record.attachments,
      };

      storage.emails.setStatus(emailId, 'processing');
      const run = storage.runs.start(emailId, providerName, modelName);
      storage.emails.setLatestRun(emailId, run.id);

      const record_ = (report: AttemptReport) =>
        storage.runs.recordInvocation({ runId: run.id, ...report });

      try {
        const degradations: string[] = [];

        // --- Agent A ---------------------------------------------------
        let extraction: ExtractionResult;
        let extractionSource: 'model' | 'rules' = 'rules';

        if (provider) {
          const outcome = await runAgent({
            agent: 'extraction',
            provider,
            system: EXTRACTION_SYSTEM_PROMPT,
            prompt: buildExtractionPrompt(email),
            schema: extractionResultSchema,
            timeoutMs,
            maxRetries,
            onAttempt: record_,
            ...(options.sleep ? { sleep: options.sleep } : {}),
          });

          if (outcome.ok) {
            extraction = outcome.value;
            extractionSource = 'model';
          } else {
            extraction = heuristicExtraction(email);
            degradations.push(`extraction agent fell back to rules (${outcome.error})`);
          }
        } else {
          extraction = heuristicExtraction(email);
        }

        storage.runs.saveExtraction(emailId, run.id, extraction);

        // --- Agent B ---------------------------------------------------
        let assessment: RiskGraphResult;
        let riskSource: 'model' | 'rules' = 'rules';

        if (provider) {
          const outcome = await runAgent({
            agent: 'risk_graph',
            provider,
            system: RISK_SYSTEM_PROMPT,
            prompt: buildRiskPrompt(email, extraction),
            schema: riskGraphResultSchema,
            timeoutMs,
            maxRetries,
            onAttempt: record_,
            ...(options.sleep ? { sleep: options.sleep } : {}),
          });

          if (outcome.ok) {
            assessment = outcome.value;
            riskSource = 'model';
          } else {
            assessment = heuristicRiskGraph(email, extraction, heuristicOptions);
            degradations.push(`risk agent fell back to rules (${outcome.error})`);
          }
        } else {
          assessment = heuristicRiskGraph(email, extraction, heuristicOptions);
        }

        storage.runs.saveRisk(emailId, run.id, assessment.risk);
        const fragment = storage.graph.persistFragment({
          emailId,
          runId: run.id,
          entities: assessment.entities,
          relationships: assessment.relationships,
        });

        // A run only counts as degraded when a model was expected and did not
        // deliver. Running deliberately without a provider is not a failure.
        const degraded = provider !== null && degradations.length > 0;
        const status: RunStatus = degraded ? 'degraded' : 'completed';
        const degradedReason = degraded ? degradations.join('; ') : null;

        storage.runs.finish(run.id, {
          status,
          ...(degradedReason ? { degradedReason } : {}),
        });
        storage.emails.setStatus(emailId, degraded ? 'degraded' : 'completed');

        return {
          emailId,
          runId: run.id,
          status,
          riskLevel: assessment.risk.level,
          degradedReason,
          extractionSource,
          riskSource,
          entityCount: fragment.entityCount,
          relationshipCount: fragment.relationshipCount,
        };
      } catch (error) {
        // Reached only on an unexpected fault — a storage error, or heuristics
        // themselves throwing. The raw email stays readable either way.
        const message = error instanceof Error ? error.message : 'unknown pipeline error';
        storage.runs.finish(run.id, { status: 'failed', error: message });
        storage.emails.setStatus(emailId, 'failed');

        return {
          emailId,
          runId: run.id,
          status: 'failed',
          riskLevel: 'none',
          degradedReason: message,
          extractionSource: 'rules',
          riskSource: 'rules',
          entityCount: 0,
          relationshipCount: 0,
        };
      }
    },
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
