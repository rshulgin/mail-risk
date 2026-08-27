import { describe, expect, it } from 'vitest';
import { RISK_LEVELS, RISK_ORDER, type RiskLevel } from './index.js';

describe('risk taxonomy', () => {
  it('orders every level and only those levels', () => {
    expect(Object.keys(RISK_ORDER).sort()).toEqual([...RISK_LEVELS].sort());
  });

  it('ranks levels monotonically from none to high', () => {
    const ranks = RISK_LEVELS.map((level: RiskLevel) => RISK_ORDER[level]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
