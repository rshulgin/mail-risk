import { describe, expect, it } from 'vitest';
import {
  isCriticalMiss,
  matchesAny,
  normalizeForMatch,
  scoreRisk,
  someMatchesAny,
} from './matching.js';

describe('normalizeForMatch', () => {
  it('collapses currency formatting so amounts compare by value', () => {
    expect(normalizeForMatch('$184,500')).toBe('184500');
    expect(normalizeForMatch('184,500.00')).toBe('184500.00');
  });

  it('is case and whitespace insensitive', () => {
    expect(normalizeForMatch('  James  Harrington ')).toBe('jamesharrington');
  });
});

describe('matchesAny', () => {
  it('matches a formatted amount against its bare digits', () => {
    expect(matchesAny('$184,500', ['184500'])).toBe(true);
  });

  it('matches a surname inside a full name', () => {
    expect(matchesAny('James Harrington', ['harrington'])).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesAny('Northgate Suppliers', ['harrington'])).toBe(false);
  });

  it('treats an empty expectation as satisfied', () => {
    expect(matchesAny('anything', [])).toBe(true);
  });

  it('scans every candidate', () => {
    expect(someMatchesAny(['Arcline', 'Talbot Industries'], ['talbot'])).toBe(true);
    expect(someMatchesAny(['Arcline'], ['talbot'])).toBe(false);
  });
});

describe('scoreRisk', () => {
  it('gives full credit for an exact band', () => {
    expect(scoreRisk('high', 'high')).toBe(1);
  });

  it('gives half credit for an adjacent band', () => {
    expect(scoreRisk('high', 'medium')).toBe(0.5);
    expect(scoreRisk('none', 'low')).toBe(0.5);
  });

  it('gives no credit two bands out', () => {
    expect(scoreRisk('high', 'low')).toBe(0);
    expect(scoreRisk('high', 'none')).toBe(0);
  });
});

describe('isCriticalMiss', () => {
  it('flags a risky email scored below its floor', () => {
    expect(isCriticalMiss('medium', 'low')).toBe(true);
  });

  it('accepts a score at or above the floor', () => {
    expect(isCriticalMiss('medium', 'medium')).toBe(false);
    expect(isCriticalMiss('medium', 'high')).toBe(false);
  });

  it('never flags cases without a floor', () => {
    expect(isCriticalMiss(undefined, 'none')).toBe(false);
  });
});
