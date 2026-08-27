import { z } from 'zod';

export const RISK_LEVELS = ['none', 'low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Ordering used for filtering, sorting and adjacent-band eval scoring. */
export const RISK_ORDER: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export const riskLevelSchema = z.enum(RISK_LEVELS);

/**
 * A seeded vocabulary, not a closed one.
 *
 * These are the tags the prompt suggests and the UI knows how to explain, but
 * `riskTagSchema` accepts any kebab-case string so a model can surface a risk
 * category we did not anticipate. Closing the enum would silently drop real
 * signal; leaving it open costs us only a slightly messier tag cloud.
 */
export const SUGGESTED_RISK_TAGS = [
  'urgency',
  'financial-anomaly',
  'threat-language',
  'mnpi-risk',
  'impersonation',
  'phishing',
  'payment-redirect',
  'data-exfiltration',
  'insider-threat',
  'confidentiality',
  'unusual-recipient',
  'credential-request',
] as const;

export type SuggestedRiskTag = (typeof SUGGESTED_RISK_TAGS)[number];

/** Lowercase, hyphenated, no spaces — so tags group reliably across emails. */
export function normalizeRiskTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

export const riskTagSchema = z
  .string()
  .transform(normalizeRiskTag)
  .refine((tag) => tag.length > 0, { message: 'tag is empty after normalisation' });
