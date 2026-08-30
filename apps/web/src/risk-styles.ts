import type { EmailStatus, EntityType, RiskLevel } from '@mri/shared';

/**
 * Tailwind scans source for *literal* class strings, so these must be written
 * out in full rather than built with template literals. One map per concept,
 * used everywhere that concept is rendered.
 */
export const RISK_BADGE_CLASS: Record<RiskLevel, string> = {
  none: 'bg-risk-none-bg text-risk-none border-risk-none-border',
  low: 'bg-risk-low-bg text-risk-low border-risk-low-border',
  medium: 'bg-risk-medium-bg text-risk-medium border-risk-medium-border',
  high: 'bg-risk-high-bg text-risk-high border-risk-high-border',
};

/** The left rule on an inbox row — carries risk without relying on colour alone. */
export const RISK_RULE_CLASS: Record<RiskLevel, string> = {
  none: 'border-l-risk-none-border',
  low: 'border-l-risk-low',
  medium: 'border-l-risk-medium',
  high: 'border-l-risk-high',
};

export const STATUS_LABEL: Record<EmailStatus, string> = {
  pending: 'Queued',
  processing: 'Analysing',
  completed: 'Analysed',
  degraded: 'Partial',
  failed: 'Failed',
};

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  person: 'People',
  organization: 'Organisations',
  amount: 'Amounts',
  account: 'Accounts',
  location: 'Locations',
};

/** Rendered next to the type label so entity kinds are distinguishable at a glance. */
export const ENTITY_TYPE_ICON: Record<EntityType, string> = {
  person: 'person',
  organization: 'org',
  amount: 'amount',
  account: 'account',
  location: 'location',
};
