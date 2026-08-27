/**
 * Shared domain contracts for Mail Risk Intelligence.
 *
 * Everything the API and the web app agree on lives here: Zod schemas for the
 * two agents' output, the risk taxonomy, and the entity normalisation rules.
 * Slice 1 fills this in; slice 0 only establishes the package boundary.
 */

export const RISK_LEVELS = ['none', 'low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Ordering used for filtering and for "adjacent band" scoring in the eval. */
export const RISK_ORDER: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export const ENTITY_TYPES = [
  'person',
  'organization',
  'amount',
  'account',
  'location',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Lifecycle of one email through the pipeline. */
export const EMAIL_STATUSES = [
  'pending',
  'processing',
  'completed',
  'degraded',
  'failed',
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
