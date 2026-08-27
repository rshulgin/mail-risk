import { z } from 'zod';

export const ENTITY_TYPES = [
  'person',
  'organization',
  'amount',
  'account',
  'location',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export const entityTypeSchema = z.enum(ENTITY_TYPES);

export const extractedEntitySchema = z.object({
  type: entityTypeSchema,
  name: z.string().min(1),
  /** Why the model believes this entity is here. Shown in the UI, not keyed on. */
  context: z.string().default(''),
});
export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;

/**
 * Relationship types are an open vocabulary on purpose.
 *
 * A closed enum would force every observation into a predefined slot and lose
 * the specific verb that makes a graph edge worth reading
 * (`requests_transfer_to` says far more than `related_to`). The trade is that
 * the UI must handle labels it has never seen, which it does by rendering them
 * verbatim.
 */
export const SUGGESTED_RELATIONSHIP_TYPES = [
  'requests_transfer_to',
  'employed_by',
  'sends_to',
  'invoices',
  'references',
  'threatens',
  'discloses_information_to',
  'holds_account',
  'located_in',
] as const;

/** snake_case, so `requests transfer to` and `Requests_Transfer_To` unify. */
export function normalizeRelationshipType(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
}

export const extractedRelationshipSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z
    .string()
    .transform(normalizeRelationshipType)
    .refine((t) => t.length > 0, { message: 'relationship type is empty' }),
  evidence: z.string().default(''),
});
export type ExtractedRelationship = z.infer<typeof extractedRelationshipSchema>;

// ---------------------------------------------------------------------------
// Canonical keys
// ---------------------------------------------------------------------------

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'madam']);

/** Functional mailbox words that describe a role, not a person. */
const ROLE_WORDS = new Set([
  'ceo', 'cfo', 'coo', 'cto', 'chair', 'chairman', 'president', 'director',
  'admin', 'info', 'noreply', 'no', 'reply', 'support', 'billing', 'accounts',
  'payable', 'hr', 'it', 'notifications', 'alert', 'alerts', 'security',
  'compliance', 'finance', 'ops', 'team', 'staff', 'all', 'private',
  'personal', 'external', 'ext', 'contact', 'office',
]);

/** Legal-form suffixes that vary by how formally the name was written. */
const ORG_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'plc', 'gmbh', 'ag', 'sa', 'nv', 'bv', 'pty', 'group',
  'holdings', 'holding',
]);

const isEmailAddress = (value: string): boolean => /^[^\s@]+@[^\s@]+$/.test(value.trim());

/** `"James Harrington" <j.h@x.com>` and `j.h@x.com` both yield `j.h`. */
function emailLocalPart(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  const address = (angled?.[1] ?? value).trim();
  const at = address.indexOf('@');
  return at === -1 ? address : address.slice(0, at);
}

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Convert an amount to a bare number string so formatting stops mattering:
 * `$1.2M`, `1,200,000` and `1200000` all become `1200000`.
 * Returns null when there is no number to work with.
 */
function canonicalAmount(value: string): string | null {
  const cleaned = value.toLowerCase().replace(/[,\s]/g, '');
  const match = /(-?\d+(?:\.\d+)?)\s*(k|m|bn|b)?/.exec(cleaned);
  if (!match?.[1]) return null;

  const magnitude = { k: 1e3, m: 1e6, bn: 1e9, b: 1e9 }[match[2] ?? ''] ?? 1;
  const scaled = Number.parseFloat(match[1]) * magnitude;
  if (!Number.isFinite(scaled)) return null;

  // Integers print without a trailing `.0`; fractional cents survive.
  return Number.isInteger(scaled) ? scaled.toFixed(0) : String(scaled);
}

/**
 * The single rule that decides whether two mentions are the same thing.
 *
 * Deliberately conservative: it merges on formatting variance only, never on
 * a guess about whether two differently-named organisations are related. Over-
 * merging a knowledge graph used for risk work is worse than under-merging,
 * because a wrongly-merged node invents a connection that was never observed.
 *
 * Per type:
 *   person        first initial + surname, so "James Harrington",
 *                 "J. Harrington" and "j.harrington-ceo@..." converge.
 *   organization  full name minus legal suffixes. "Northgate Suppliers Inc."
 *                 merges with "Northgate Suppliers"; bare "Northgate" does not
 *                 — that would be a guess.
 *   amount        numeric value.
 *   account       digits only, so "ending 6621" and "****6621" converge.
 *   location      lowercased words.
 *
 * Returns null when there is nothing left to key on, which callers treat as
 * "drop this entity" rather than creating a blank node.
 */
export function normalizeEntityKey(type: EntityType, rawName: string): string | null {
  const name = rawName.trim();
  if (!name) return null;

  switch (type) {
    case 'person': {
      const base = isEmailAddress(name) || name.includes('<') ? emailLocalPart(name) : name;
      const tokens = tokenize(base).filter((t) => !TITLES.has(t) && !ROLE_WORDS.has(t));
      if (tokens.length === 0) return null;
      if (tokens.length === 1) return tokens[0] ?? null;

      const first = tokens[0] ?? '';
      const surname = tokens[tokens.length - 1] ?? '';
      return `${first.charAt(0)} ${surname}`;
    }

    case 'organization': {
      const base = isEmailAddress(name) ? (name.split('@')[1] ?? name) : name;
      const tokens = tokenize(base)
        .filter((t) => !ORG_SUFFIXES.has(t))
        // Drop the TLD when the name came from a domain.
        .filter((t) => !['com', 'net', 'org', 'io', 'co', 'uk'].includes(t));
      if (tokens.length === 0) return null;
      return tokens.join(' ');
    }

    case 'amount':
      return canonicalAmount(name);

    case 'account': {
      const digits = name.replace(/\D/g, '');
      return digits.length > 0 ? digits : null;
    }

    case 'location': {
      const tokens = tokenize(name);
      return tokens.length > 0 ? tokens.join(' ') : null;
    }
  }
}
