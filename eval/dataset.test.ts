import { describe, expect, it } from 'vitest';
import { findCoverageGaps, loadCorpusIds, loadDataset } from './dataset.js';

describe('golden dataset', () => {
  const dataset = loadDataset();

  it('parses against its schema', () => {
    expect(dataset.cases.length).toBeGreaterThan(0);
  });

  it('covers the seed corpus exactly', () => {
    const gaps = findCoverageGaps(dataset, loadCorpusIds(dataset));
    expect(gaps).toEqual({ uncovered: [], orphaned: [], duplicated: [] });
  });

  it('includes benign cases, so the eval measures precision and not just recall', () => {
    const benign = dataset.cases.filter((c) => c.expectedRisk === 'none');
    expect(benign.length).toBeGreaterThanOrEqual(2);
    expect(benign.every((c) => c.forbiddenTags.length > 0)).toBe(true);
  });

  it('puts a risk floor on every case it expects to be risky', () => {
    const risky = dataset.cases.filter(
      (c) => c.expectedRisk === 'high' || c.expectedRisk === 'medium',
    );
    expect(risky.every((c) => c.minimumAcceptableRisk !== undefined)).toBe(true);
  });
});
