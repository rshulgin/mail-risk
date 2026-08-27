import { exit } from 'node:process';
import { RISK_LEVELS, type RiskLevel } from '@mri/shared';
import { findCoverageGaps, loadCorpusIds, loadDataset } from './dataset.js';

/**
 * `npm run eval` - golden-dataset scoring for the two-agent pipeline.
 *
 * Deliberately separate from `npm test`: this one calls a real model, so its
 * results move between runs. Letting it gate the test suite would make CI a
 * coin flip. Scoring goes live in slice 2, once there is a pipeline to score.
 */

function main(): number {
  const dataset = loadDataset();
  const corpusIds = loadCorpusIds(dataset);
  const gaps = findCoverageGaps(dataset, corpusIds);

  console.log('Mail Risk Intelligence - golden dataset');
  console.log('='.repeat(64));
  console.log(`corpus   ${dataset.corpus} (${corpusIds.length} emails)`);
  console.log(`cases    eval/expected.json v${dataset.version} (${dataset.cases.length})`);

  if (gaps.uncovered.length || gaps.orphaned.length || gaps.duplicated.length) {
    console.error('\nDataset does not line up with the corpus:');
    if (gaps.uncovered.length) console.error(`  no case for: ${gaps.uncovered.join(', ')}`);
    if (gaps.orphaned.length) console.error(`  no email for: ${gaps.orphaned.join(', ')}`);
    if (gaps.duplicated.length) console.error(`  duplicate ids: ${gaps.duplicated.join(', ')}`);
    return 1;
  }

  const byLevel = new Map<RiskLevel, number>(RISK_LEVELS.map((level) => [level, 0]));
  for (const testCase of dataset.cases) {
    byLevel.set(testCase.expectedRisk, (byLevel.get(testCase.expectedRisk) ?? 0) + 1);
  }
  const distribution = RISK_LEVELS.map((level) => `${level}=${byLevel.get(level) ?? 0}`).join('  ');

  console.log(`coverage complete\n`);
  console.log(`expected risk distribution: ${distribution}`);
  console.log(
    `critical floors set on ${dataset.cases.filter((c) => c.minimumAcceptableRisk).length} cases\n`,
  );

  for (const testCase of dataset.cases) {
    const floor = testCase.minimumAcceptableRisk ? ` (floor ${testCase.minimumAcceptableRisk})` : '';
    console.log(`  ${testCase.id}  ${testCase.expectedRisk.padEnd(6)}${floor.padEnd(16)} ${testCase.label}`);
  }

  console.log('\n' + '-'.repeat(64));
  console.log('Pipeline not implemented yet - scoring lands in slice 2.');
  console.log('The dataset above is validated and covers the corpus exactly.');
  return 0;
}

exit(main());
