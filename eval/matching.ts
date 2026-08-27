import { RISK_ORDER, type RiskLevel } from '@mri/shared';

/**
 * Fuzzy-match helpers shared by the golden-dataset scorer.
 *
 * Kept separate from the runner so the matching rules are unit-testable
 * without a model, a database or a running pipeline.
 */

/**
 * Canonical form used on both sides of every comparison in expected.json.
 * Lowercase, and drop the characters that vary purely by formatting so that
 * "$184,500", "184500" and "184,500" all collapse to the same string.
 */
export function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[$,\s]/g, '');
}

/** True when `candidate` contains any of the expected substrings. */
export function matchesAny(candidate: string, needles: readonly string[]): boolean {
  if (needles.length === 0) return true;
  const haystack = normalizeForMatch(candidate);
  return needles.some((needle) => haystack.includes(normalizeForMatch(needle)));
}

/** True when any candidate contains any of the expected substrings. */
export function someMatchesAny(
  candidates: readonly string[],
  needles: readonly string[],
): boolean {
  return candidates.some((candidate) => matchesAny(candidate, needles));
}

/**
 * Risk scoring is graded, not binary: predicting `medium` where `high` was
 * expected is a near miss, not the same failure as predicting `none`.
 */
export function scoreRisk(expected: RiskLevel, actual: RiskLevel): number {
  const distance = Math.abs(RISK_ORDER[expected] - RISK_ORDER[actual]);
  if (distance === 0) return 1;
  if (distance === 1) return 0.5;
  return 0;
}

/**
 * A critical miss is a risky email scored below its floor. Reported separately
 * from the average, because "missed the wire fraud entirely" should never be
 * averaged away by ten benign emails scoring perfectly.
 */
export function isCriticalMiss(
  minimumAcceptable: RiskLevel | undefined,
  actual: RiskLevel,
): boolean {
  if (!minimumAcceptable) return false;
  return RISK_ORDER[actual] < RISK_ORDER[minimumAcceptable];
}
