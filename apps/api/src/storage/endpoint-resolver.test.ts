import { describe, expect, it } from 'vitest';
import { resolveEndpoint, type ResolvableEntity } from './endpoint-resolver.js';

const entity = (
  id: string,
  type: ResolvableEntity['type'],
  displayName: string,
  canonicalKey: string,
): ResolvableEntity => ({ id, type, displayName, canonicalKey });

describe('resolveEndpoint', () => {
  const candidates = [
    entity('1', 'person', 'James Harrington', 'j harrington'),
    entity('2', 'organization', 'Arcline', 'arcline'),
    entity('3', 'amount', '$184,500', '184500'),
  ];

  it('matches on canonical key despite different formatting', () => {
    expect(resolveEndpoint('J. Harrington', candidates)?.id).toBe('1');
    expect(resolveEndpoint('184500', candidates)?.id).toBe('3');
  });

  it('matches a partial name when it is unambiguous', () => {
    expect(resolveEndpoint('James', candidates)?.id).toBe('1');
  });

  it('declines when a partial name could mean two entities', () => {
    const ambiguous = [
      entity('1', 'person', 'James Harrington', 'j harrington'),
      entity('2', 'person', 'James Talbot', 'j talbot'),
    ];
    expect(resolveEndpoint('James', ambiguous)).toBeNull();
  });

  it('declines on a name that was never mentioned', () => {
    expect(resolveEndpoint('Escrow Partner', candidates)).toBeNull();
  });

  it('declines on empty input or an empty candidate set', () => {
    expect(resolveEndpoint('  ', candidates)).toBeNull();
    expect(resolveEndpoint('James Harrington', [])).toBeNull();
  });
});
