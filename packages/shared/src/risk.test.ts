import { describe, expect, it } from 'vitest';
import { RISK_LEVELS, RISK_ORDER, normalizeRiskTag, riskTagSchema } from './risk.js';

describe('risk taxonomy', () => {
  it('orders every level and only those levels', () => {
    expect(Object.keys(RISK_ORDER).sort()).toEqual([...RISK_LEVELS].sort());
  });

  it('ranks levels monotonically from none to high', () => {
    const ranks = RISK_LEVELS.map((level) => RISK_ORDER[level]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('risk tags', () => {
  it('normalises the ways a model might write the same tag', () => {
    expect(normalizeRiskTag('Financial Anomaly')).toBe('financial-anomaly');
    expect(normalizeRiskTag('financial_anomaly')).toBe('financial-anomaly');
    expect(normalizeRiskTag('  FINANCIAL-ANOMALY  ')).toBe('financial-anomaly');
  });

  it('accepts a tag outside the suggested vocabulary', () => {
    expect(riskTagSchema.parse('Sanctions Exposure')).toBe('sanctions-exposure');
  });

  it('rejects a tag that normalises to nothing', () => {
    expect(riskTagSchema.safeParse('!!!').success).toBe(false);
  });
});
