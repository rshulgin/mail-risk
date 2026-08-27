import { ENTITY_TYPES, normalizeEntityKey, type EntityType } from '@mri/shared';

/**
 * Agent B returns relationships as free strings ("James Harrington" ->
 * "Escrow Partner"), which must be tied back to entities it listed separately.
 * Models are not consistent about this: the entity list may say "James
 * Harrington" while the relationship says "James".
 *
 * The ladder below resolves endpoints deterministically, and refuses to guess
 * when a name is ambiguous. Unresolved endpoints drop their edge rather than
 * inventing a node — a knowledge graph used for risk work should never show a
 * connection that was not observed.
 */

export interface ResolvableEntity {
  id: string;
  type: EntityType;
  canonicalKey: string;
  displayName: string;
}

const tokens = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const isSubset = (a: string[], b: string[]): boolean =>
  a.length > 0 && a.every((token) => b.includes(token));

export function resolveEndpoint(
  name: string,
  candidates: readonly ResolvableEntity[],
): ResolvableEntity | null {
  const trimmed = name.trim();
  if (!trimmed || candidates.length === 0) return null;

  // 1. The name normalises to exactly the same canonical key as an entity.
  for (const type of ENTITY_TYPES) {
    const key = normalizeEntityKey(type, trimmed);
    if (!key) continue;
    const hit = candidates.find((c) => c.type === type && c.canonicalKey === key);
    if (hit) return hit;
  }

  // 2. Case-insensitive match on the display name as written.
  const lowered = trimmed.toLowerCase();
  const byDisplay = candidates.filter((c) => c.displayName.toLowerCase() === lowered);
  if (byDisplay.length === 1) return byDisplay[0] ?? null;

  // 3. Token containment in either direction ("James" <-> "James Harrington"),
  //    but only when exactly one candidate matches. Two matches means we cannot
  //    tell them apart, so we decline.
  const needle = tokens(trimmed);
  const overlapping = candidates.filter((candidate) => {
    const hay = tokens(candidate.displayName);
    return isSubset(needle, hay) || isSubset(hay, needle);
  });

  return overlapping.length === 1 ? (overlapping[0] ?? null) : null;
}
