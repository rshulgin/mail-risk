import type { EntityType, RiskLevel } from '@mri/shared';
import type { EvalCase } from './dataset.js';
import { isCriticalMiss, matchesAny, scoreRisk, someMatchesAny } from './matching.js';

/**
 * Scoring for one email against its ground truth.
 *
 * Four components, weighted. Risk carries the most weight because it is the
 * decision the tool exists to support; relationships carry the least because
 * they are the most sensitive to how a model chooses to phrase an edge.
 */
const WEIGHTS = { risk: 0.4, tags: 0.2, entities: 0.25, relationships: 0.15 } as const;

export interface ActualEntity {
  type: EntityType;
  displayName: string;
  canonicalKey: string;
}

export interface ActualRelationship {
  source: string;
  target: string;
  type: string;
}

export interface ActualResult {
  riskLevel: RiskLevel;
  tags: string[];
  entities: ActualEntity[];
  relationships: ActualRelationship[];
}

export interface ComponentScore {
  matched: number;
  total: number;
  missing: string[];
}

export interface CaseScore {
  id: string;
  label: string;
  expectedRisk: RiskLevel;
  actualRisk: RiskLevel;
  riskScore: number;
  criticalMiss: boolean;
  tags: ComponentScore;
  forbiddenTagsPresent: string[];
  entities: ComponentScore;
  relationships: ComponentScore;
  overall: number;
}

const describeEntity = (expected: { type: EntityType; matchAnyOf: string[] }): string =>
  `${expected.type}:${expected.matchAnyOf[0] ?? '?'}`;

const describeRelationship = (expected: {
  sourceMatchAnyOf?: string[];
  targetMatchAnyOf?: string[];
}): string => `${expected.sourceMatchAnyOf?.[0] ?? '*'}->${expected.targetMatchAnyOf?.[0] ?? '*'}`;

export function scoreCase(expected: EvalCase, actual: ActualResult): CaseScore {
  // --- tags ---------------------------------------------------------------
  const tagsMissing: string[] = [];
  let tagsMatched = 0;
  for (const group of expected.requiredTagGroups) {
    if (someMatchesAny(actual.tags, group)) tagsMatched += 1;
    else tagsMissing.push(group[0] ?? '?');
  }

  const forbiddenTagsPresent = expected.forbiddenTags.filter((forbidden) =>
    actual.tags.some((tag) => tag === forbidden),
  );

  // --- entities -----------------------------------------------------------
  const entitiesMissing: string[] = [];
  let entitiesMatched = 0;
  for (const wanted of expected.requiredEntities) {
    const found = actual.entities.some(
      (entity) =>
        entity.type === wanted.type &&
        (matchesAny(entity.displayName, wanted.matchAnyOf) ||
          matchesAny(entity.canonicalKey, wanted.matchAnyOf)),
    );
    if (found) entitiesMatched += 1;
    else entitiesMissing.push(describeEntity(wanted));
  }

  // --- relationships ------------------------------------------------------
  const relationshipsMissing: string[] = [];
  let relationshipsMatched = 0;
  for (const wanted of expected.requiredRelationships) {
    const found = actual.relationships.some((edge) => {
      const sourceOk = !wanted.sourceMatchAnyOf || matchesAny(edge.source, wanted.sourceMatchAnyOf);
      const targetOk = !wanted.targetMatchAnyOf || matchesAny(edge.target, wanted.targetMatchAnyOf);
      const typeOk = !wanted.typeAnyOf || matchesAny(edge.type, wanted.typeAnyOf);
      return sourceOk && targetOk && typeOk;
    });
    if (found) relationshipsMatched += 1;
    else relationshipsMissing.push(describeRelationship(wanted));
  }

  // --- combine ------------------------------------------------------------
  const riskScore = scoreRisk(expected.expectedRisk, actual.riskLevel);

  const tagBase = expected.requiredTagGroups.length
    ? tagsMatched / expected.requiredTagGroups.length
    : 1;
  // A benign email tagged `fraud` has failed the tag component outright; that
  // is a precision failure, and averaging it away would hide it.
  const tagComponent = forbiddenTagsPresent.length > 0 ? 0 : tagBase;

  const parts: [number, number][] = [
    [riskScore, WEIGHTS.risk],
    [tagComponent, WEIGHTS.tags],
  ];
  if (expected.requiredEntities.length) {
    parts.push([entitiesMatched / expected.requiredEntities.length, WEIGHTS.entities]);
  }
  if (expected.requiredRelationships.length) {
    parts.push([relationshipsMatched / expected.requiredRelationships.length, WEIGHTS.relationships]);
  }

  const weightTotal = parts.reduce((sum, [, weight]) => sum + weight, 0);
  const overall = parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / weightTotal;

  return {
    id: expected.id,
    label: expected.label,
    expectedRisk: expected.expectedRisk,
    actualRisk: actual.riskLevel,
    riskScore,
    criticalMiss: isCriticalMiss(expected.minimumAcceptableRisk, actual.riskLevel),
    tags: {
      matched: tagsMatched,
      total: expected.requiredTagGroups.length,
      missing: tagsMissing,
    },
    forbiddenTagsPresent,
    entities: {
      matched: entitiesMatched,
      total: expected.requiredEntities.length,
      missing: entitiesMissing,
    },
    relationships: {
      matched: relationshipsMatched,
      total: expected.requiredRelationships.length,
      missing: relationshipsMissing,
    },
    overall,
  };
}

export interface Aggregate {
  cases: number;
  overall: number;
  riskExact: number;
  riskAdjacent: number;
  riskScore: number;
  criticalMisses: string[];
  falsePositives: string[];
  tagRecall: number;
  entityRecall: number;
  relationshipRecall: number;
}

const ratio = (matched: number, total: number): number => (total === 0 ? 1 : matched / total);

export function aggregate(scores: readonly CaseScore[]): Aggregate {
  const sum = (pick: (score: CaseScore) => number): number =>
    scores.reduce((total, score) => total + pick(score), 0);

  const totals = scores.reduce(
    (acc, score) => ({
      tagMatched: acc.tagMatched + score.tags.matched,
      tagTotal: acc.tagTotal + score.tags.total,
      entityMatched: acc.entityMatched + score.entities.matched,
      entityTotal: acc.entityTotal + score.entities.total,
      relMatched: acc.relMatched + score.relationships.matched,
      relTotal: acc.relTotal + score.relationships.total,
    }),
    { tagMatched: 0, tagTotal: 0, entityMatched: 0, entityTotal: 0, relMatched: 0, relTotal: 0 },
  );

  return {
    cases: scores.length,
    overall: scores.length ? sum((s) => s.overall) / scores.length : 0,
    riskExact: scores.filter((s) => s.riskScore === 1).length,
    riskAdjacent: scores.filter((s) => s.riskScore === 0.5).length,
    riskScore: scores.length ? sum((s) => s.riskScore) / scores.length : 0,
    criticalMisses: scores.filter((s) => s.criticalMiss).map((s) => s.id),
    // Benign emails carrying a tag they should never have.
    falsePositives: scores.filter((s) => s.forbiddenTagsPresent.length > 0).map((s) => s.id),
    tagRecall: ratio(totals.tagMatched, totals.tagTotal),
    entityRecall: ratio(totals.entityMatched, totals.entityTotal),
    relationshipRecall: ratio(totals.relMatched, totals.relTotal),
  };
}
