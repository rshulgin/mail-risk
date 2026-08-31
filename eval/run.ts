import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { seedCorpusSchema, seedEmailToRawEmail, type RiskLevel } from '@mri/shared';
import { config } from '../apps/api/src/config.js';
import { createStorage } from '../apps/api/src/storage/index.js';
import { createOrchestrator } from '../apps/api/src/agents/orchestrator.js';
import { resolveProvider } from '../apps/api/src/agents/providers/index.js';
import { findCoverageGaps, loadCorpusIds, loadDataset } from './dataset.js';
import { aggregate, scoreCase, type ActualResult, type CaseScore } from './score.js';

/**
 * `npm run eval` - scores the real pipeline against the golden dataset.
 *
 * Separate from `npm test` on purpose: this calls a model, so results move
 * between runs and would make the test suite a coin flip. Report-only unless
 * `--threshold` is passed.
 *
 * Flags:
 *   --threshold=0.7      exit non-zero if the overall score falls below this
 *   --provider=rules     override LLM_PROVIDER for this run
 *   --model=mistral      override the model, for comparing local models
 *   --limit=3            score only the first N cases, for a quick loop
 */

const flag = (name: string): string | undefined =>
  argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;

const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));

async function main(): Promise<number> {
  const dataset = loadDataset();
  const corpusIds = loadCorpusIds(dataset);
  const gaps = findCoverageGaps(dataset, corpusIds);

  if (gaps.uncovered.length || gaps.orphaned.length || gaps.duplicated.length) {
    console.error('Dataset does not line up with the corpus:', gaps);
    return 1;
  }

  const providerOverride = flag('provider');
  const modelOverride = flag('model');
  const effectiveConfig = {
    ...config,
    llm: {
      ...config.llm,
      ...(providerOverride
        ? { provider: providerOverride as 'ollama' | 'gemini' | 'rules' }
        : {}),
      ...(modelOverride ? { ollamaModel: modelOverride, geminiModel: modelOverride } : {}),
    },
  };

  const resolution = await resolveProvider(effectiveConfig);
  const providerLabel = resolution.provider
    ? `${resolution.provider.name}/${resolution.provider.model}`
    : 'rules/heuristic-v1';

  console.log('Mail Risk Intelligence - golden dataset eval');
  console.log('='.repeat(78));
  console.log(`provider   ${providerLabel}`);
  if (resolution.fallbackReason) {
    console.log(`           requested "${resolution.requested}" but fell back: ${resolution.fallbackReason}`);
  }
  console.log(`corpus     ${dataset.corpus} (${corpusIds.length} emails)`);

  // A fresh in-memory database each run, so scores are never contaminated by
  // a previous run's graph.
  const storage = createStorage(':memory:');
  const orchestrator = createOrchestrator({
    storage,
    provider: resolution.provider,
    timeoutMs: config.pipeline.agentTimeoutMs,
    maxRetries: config.pipeline.agentMaxRetries,
    internalDomains: config.pipeline.internalDomains,
  });

  const corpus = seedCorpusSchema.parse(JSON.parse(readFileSync(config.seedPath, 'utf8')));
  const limit = Number.parseInt(flag('limit') ?? '', 10);
  const cases = Number.isFinite(limit) ? dataset.cases.slice(0, limit) : dataset.cases;
  const seedById = new Map(corpus.emails.map((seed) => [seed.id, seed]));

  console.log(`cases      ${cases.length}\n`);

  const scores: CaseScore[] = [];
  const health = { degraded: 0, failed: 0, extractionFallbacks: 0, riskFallbacks: 0, retries: 0 };
  const startedAt = Date.now();

  for (const testCase of cases) {
    const seed = seedById.get(testCase.id);
    if (!seed) continue;

    const inserted = storage.emails.insert({
      email: seedEmailToRawEmail(seed),
      rawText: seed.body,
      source: 'seed',
    });

    stdout.write(`  ${testCase.id} … `);
    const caseStartedAt = Date.now();
    const outcome = await orchestrator.process(inserted.id);
    const elapsed = Date.now() - caseStartedAt;

    if (!outcome) {
      stdout.write('skipped (not stored)\n');
      continue;
    }

    if (outcome.status === 'degraded') health.degraded += 1;
    if (outcome.status === 'failed') health.failed += 1;
    if (outcome.extractionSource === 'rules' && resolution.provider) health.extractionFallbacks += 1;
    if (outcome.riskSource === 'rules' && resolution.provider) health.riskFallbacks += 1;
    health.retries += storage.runs
      .listInvocations(outcome.runId)
      .filter((invocation) => invocation.status !== 'ok').length;

    const risk = storage.runs.getRisk(outcome.runId);
    const graph = storage.graph.getEmailGraph(inserted.id);

    const result: ActualResult = {
      riskLevel: (risk?.level ?? 'none') as RiskLevel,
      tags: risk?.tags ?? [],
      entities: graph.entities.map((entity) => ({
        type: entity.type,
        displayName: entity.displayName,
        canonicalKey: entity.canonicalKey,
      })),
      relationships: graph.relationships.map((edge) => ({
        source: edge.source.displayName,
        target: edge.target.displayName,
        type: edge.type,
      })),
      sources: { extraction: outcome.extractionSource, risk: outcome.riskSource },
    };

    const score = scoreCase(testCase, result);
    scores.push(score);
    stdout.write(`${score.actualRisk.padEnd(6)} ${pct(score.overall).padStart(4)}  ${(elapsed / 1000).toFixed(1)}s\n`);
  }

  const totals = aggregate(scores);
  const durationMs = Date.now() - startedAt;

  console.log(`\n${'-'.repeat(78)}`);
  console.log('  id    expected  actual    risk   tags    entities  rels    overall');
  console.log(`  ${'-'.repeat(74)}`);
  for (const score of scores) {
    const flags = [
      score.criticalMiss ? 'CRITICAL MISS' : '',
      score.forbiddenTagsPresent.length ? `forbidden: ${score.forbiddenTagsPresent.join(',')}` : '',
    ]
      .filter(Boolean)
      .join('  ');

    console.log(
      `  ${score.id.padEnd(6)}${score.expectedRisk.padEnd(10)}${score.actualRisk.padEnd(10)}` +
        `${pct(score.riskScore).padStart(4)}   ` +
        `${`${score.tags.matched}/${score.tags.total}`.padEnd(8)}` +
        `${`${score.entities.matched}/${score.entities.total}`.padEnd(10)}` +
        `${`${score.relationships.matched}/${score.relationships.total}`.padEnd(8)}` +
        `${pct(score.overall).padStart(4)}  ${flags}`,
    );
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log(`  overall score        ${pct(totals.overall)}`);
  console.log(
    `  risk                 ${totals.riskExact}/${totals.cases} exact, ${totals.riskAdjacent} adjacent (${pct(totals.riskScore)})`,
  );
  console.log(`  tag recall           ${pct(totals.tagRecall)}`);
  console.log(`  entity recall        ${pct(totals.entityRecall)}`);
  console.log(`  relationship recall  ${pct(totals.relationshipRecall)}`);
  console.log(
    `  critical misses      ${totals.criticalMisses.length ? totals.criticalMisses.join(', ') : 'none'}`,
  );
  console.log(
    `  false positives      ${totals.falsePositives.length ? totals.falsePositives.join(', ') : 'none'}`,
  );
  console.log(
    `\n  pipeline health      ${health.degraded} degraded, ${health.failed} failed, ` +
      `${health.retries} retried attempts (extraction fallbacks ${health.extractionFallbacks}, risk ${health.riskFallbacks})`,
  );

  // Attribution matters more than the headline number. A provider that fails
  // every call still scores well, because the heuristic fallback rescues it.
  const { attribution } = totals;
  if (resolution.provider) {
    const modelScore =
      attribution.modelDrivenScore === null ? 'n/a' : pct(attribution.modelDrivenScore);
    const fallbackScore =
      attribution.fallbackAssistedScore === null ? 'n/a' : pct(attribution.fallbackAssistedScore);

    console.log(
      `  attribution          ${attribution.modelDriven}/${totals.cases} model-driven (${modelScore}), ` +
        `${attribution.fallbackAssisted} fallback-assisted (${fallbackScore})`,
    );

    if (attribution.modelDriven === 0) {
      console.log(
        `\n  !! ${providerLabel} produced no usable output on any email. The score above is`,
      );
      console.log('     entirely the rule-based fallback. Raise AGENT_TIMEOUT_MS or try a');
      console.log('     smaller model before reading anything into it.');
    } else if (attribution.fallbackAssisted > totals.cases / 3) {
      console.log(
        `\n  !! ${attribution.fallbackAssisted} of ${totals.cases} emails needed the rule-based fallback, so the`,
      );
      console.log(`     headline score overstates ${providerLabel}. Check AGENT_TIMEOUT_MS.`);
    }
  }
  console.log(`  wall clock           ${(durationMs / 1000).toFixed(1)}s\n`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outputPath = `${RESULTS_DIR}${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(
    outputPath,
    JSON.stringify(
      { provider: providerLabel, durationMs, totals, health, scores, datasetVersion: dataset.version },
      null,
      2,
    ),
  );
  console.log(`  written to ${outputPath}\n`);

  storage.close();

  const threshold = Number.parseFloat(flag('threshold') ?? '');
  if (Number.isFinite(threshold) && totals.overall < threshold) {
    console.error(`FAIL overall ${pct(totals.overall)} is below the --threshold of ${pct(threshold)}`);
    return 1;
  }
  return 0;
}

exit(await main());
