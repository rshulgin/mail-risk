import { describe, expect, it } from 'vitest';
import { normalizeEntityKey, normalizeRelationshipType } from './entities.js';

describe('normalizeEntityKey - person', () => {
  it('collapses the three ways E001 refers to the same person', () => {
    const keys = [
      'James Harrington',
      'J. Harrington',
      'j.harrington-ceo@arclne-corp.com',
    ].map((name) => normalizeEntityKey('person', name));

    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('j harrington');
  });

  it('handles a display-name mailbox', () => {
    expect(normalizeEntityKey('person', '"James Harrington" <j.harrington@x.com>')).toBe(
      'j harrington',
    );
  });

  it('strips titles', () => {
    expect(normalizeEntityKey('person', 'Dr. Robert Ainsley')).toBe('r ainsley');
  });

  it('keeps a single-token name as itself', () => {
    expect(normalizeEntityKey('person', 'Marcus')).toBe('marcus');
  });

  it('does not merge different people who share a surname initial', () => {
    expect(normalizeEntityKey('person', 'Daniel Moreno')).not.toBe(
      normalizeEntityKey('person', 'Daniel Tanaka'),
    );
  });

  it('returns null when only role words remain', () => {
    expect(normalizeEntityKey('person', 'noreply')).toBeNull();
    expect(normalizeEntityKey('person', '  ')).toBeNull();
  });
});

describe('normalizeEntityKey - organization', () => {
  it('merges on legal-suffix formatting only', () => {
    expect(normalizeEntityKey('organization', 'Northgate Suppliers Inc.')).toBe(
      normalizeEntityKey('organization', 'Northgate Suppliers'),
    );
  });

  it('does not guess that a shorter name is the same organisation', () => {
    expect(normalizeEntityKey('organization', 'Northgate')).not.toBe(
      normalizeEntityKey('organization', 'Northgate Suppliers'),
    );
  });

  it('keeps a lookalike domain distinct from the real one', () => {
    expect(normalizeEntityKey('organization', 'arcline.com')).toBe('arcline');
    expect(normalizeEntityKey('organization', 'arclline-portal.com')).toBe(
      'arclline portal',
    );
  });
});

describe('normalizeEntityKey - amount', () => {
  it('ignores currency formatting', () => {
    expect(normalizeEntityKey('amount', '$184,500')).toBe('184500');
    expect(normalizeEntityKey('amount', '184500')).toBe('184500');
  });

  it('expands magnitude suffixes', () => {
    expect(normalizeEntityKey('amount', '$1.2M')).toBe('1200000');
    expect(normalizeEntityKey('amount', '$1,200,000')).toBe('1200000');
    expect(normalizeEntityKey('amount', '$800K')).toBe('800000');
    expect(normalizeEntityKey('amount', 'about $300K')).toBe('300000');
  });

  it('returns null when there is no number', () => {
    expect(normalizeEntityKey('amount', 'a large sum')).toBeNull();
  });
});

describe('normalizeEntityKey - account', () => {
  it('reduces to digits so phrasing stops mattering', () => {
    expect(normalizeEntityKey('account', 'account ending 6621')).toBe('6621');
    expect(normalizeEntityKey('account', '****6621')).toBe('6621');
    expect(normalizeEntityKey('account', 'routing 044000037')).toBe('044000037');
  });

  it('returns null with no digits', () => {
    expect(normalizeEntityKey('account', 'the usual account')).toBeNull();
  });
});

describe('normalizeRelationshipType', () => {
  it('normalises to snake_case', () => {
    expect(normalizeRelationshipType('Requests Transfer To')).toBe('requests_transfer_to');
    expect(normalizeRelationshipType('requests-transfer-to')).toBe('requests_transfer_to');
    expect(normalizeRelationshipType('  employed_by  ')).toBe('employed_by');
  });
});
