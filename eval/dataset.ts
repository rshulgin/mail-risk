import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ENTITY_TYPES, RISK_LEVELS } from '@mri/shared';

/**
 * Loader and schema for the golden dataset. Validating expected.json at load
 * time means a typo in the ground truth fails loudly instead of silently
 * scoring every case as passing.
 */

const matcherList = z.array(z.string().min(1));

const expectedEntitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  matchAnyOf: matcherList.min(1),
});

const expectedRelationshipSchema = z
  .object({
    sourceMatchAnyOf: matcherList.optional(),
    targetMatchAnyOf: matcherList.optional(),
    typeAnyOf: matcherList.optional(),
  })
  .refine(
    (value) =>
      Boolean(value.sourceMatchAnyOf ?? value.targetMatchAnyOf ?? value.typeAnyOf),
    { message: 'a relationship expectation must constrain at least one field' },
  );

export const evalCaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  expectedRisk: z.enum(RISK_LEVELS),
  minimumAcceptableRisk: z.enum(RISK_LEVELS).optional(),
  requiredTagGroups: z.array(matcherList.min(1)).default([]),
  forbiddenTags: z.array(z.string().min(1)).default([]),
  requiredEntities: z.array(expectedEntitySchema).default([]),
  requiredRelationships: z.array(expectedRelationshipSchema).default([]),
  notes: z.string().optional(),
});

export const evalDatasetSchema = z.object({
  version: z.literal(1),
  corpus: z.string().min(1),
  _readme: z.array(z.string()).optional(),
  cases: z.array(evalCaseSchema).min(1),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalDataset = z.infer<typeof evalDatasetSchema>;

const seedEmailSchema = z.object({
  id: z.string().min(1),
  subject: z.string(),
});

const seedCorpusSchema = z.object({ emails: z.array(seedEmailSchema).min(1) });

const repoRoot = new URL('../', import.meta.url);

const readJson = (relativePath: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, repoRoot)), 'utf8'));

export function loadDataset(): EvalDataset {
  return evalDatasetSchema.parse(readJson('eval/expected.json'));
}

export function loadCorpusIds(dataset: EvalDataset): string[] {
  return seedCorpusSchema.parse(readJson(dataset.corpus)).emails.map((e) => e.id);
}

/**
 * The dataset only means something if it covers the corpus exactly: an email
 * with no case is silently unscored, and a case with no email scores nothing.
 */
export function findCoverageGaps(
  dataset: EvalDataset,
  corpusIds: readonly string[],
): { uncovered: string[]; orphaned: string[]; duplicated: string[] } {
  const caseIds = dataset.cases.map((c) => c.id);
  const caseIdSet = new Set(caseIds);
  const corpusIdSet = new Set(corpusIds);

  return {
    uncovered: corpusIds.filter((id) => !caseIdSet.has(id)),
    orphaned: caseIds.filter((id) => !corpusIdSet.has(id)),
    duplicated: caseIds.filter((id, index) => caseIds.indexOf(id) !== index),
  };
}
