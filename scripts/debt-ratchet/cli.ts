import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  BASELINE_PATH,
  DEBT_CONFIG_PATH,
  collectDebt,
  compareToBaseline,
  formatGrowth,
  formatStale,
  parseBaseline,
  parseOxlintReport,
  serializeBaseline,
  shrinkBaseline,
  totals,
} from './ratchet';

const LINTED_PATHS = ['src', 'web/src'];
const MIN_FILES = 2500;

function lintForDebt() {
  const oxlint = process.env.OXLINT ?? 'oxlint';
  const result = spawnSync(
    oxlint,
    ['-c', DEBT_CONFIG_PATH, '--format', 'json', ...LINTED_PATHS],
    {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }
  );
  if (result.error) {
    throw result.error;
  }
  const report = parseOxlintReport(result.stdout);
  if (report.number_of_files < MIN_FILES) {
    throw new Error(
      `oxlint checked ${report.number_of_files} files, below the floor of ${MIN_FILES}. Check ignorePatterns in ${DEBT_CONFIG_PATH}`
    );
  }
  return report;
}

function main(): number {
  const report = lintForDebt();
  const fileLines = new Map<string, string[]>();
  const readLine = (file: string, line: number) => {
    if (!fileLines.has(file)) {
      fileLines.set(file, readFileSync(file, 'utf8').split('\n'));
    }
    return fileLines.get(file)?.[line - 1];
  };
  const findings = collectDebt(report.diagnostics, readLine);
  const baseline = parseBaseline(readFileSync(BASELINE_PATH, 'utf8'));

  if (process.argv.includes('--shrink')) {
    const shrunk = shrinkBaseline(baseline, findings.counts);
    writeFileSync(BASELINE_PATH, serializeBaseline(shrunk));
    console.info(
      `debt: wrote ${BASELINE_PATH} (shrink-only, nothing added): ${JSON.stringify(totals(shrunk))}. Commit it, and lower DEBT_CEILINGS in scripts/debt-ratchet/ratchet.test.ts to match`
    );
  }

  const { grown, stale } = compareToBaseline(
    parseBaseline(readFileSync(BASELINE_PATH, 'utf8')),
    findings
  );
  for (const entry of stale) {
    console.info(formatStale(entry));
  }
  for (const entry of grown) {
    console.error(formatGrowth(entry));
  }
  if (grown.length > 0) {
    console.error(
      `debt: ${grown.length} new finding(s) above ${BASELINE_PATH}. That file lists debt that existed on 2026-11-24 and may only shrink; never add an entry or raise a count to make this pass (.claude/rules/code-quality.md)`
    );
    return 1;
  }
  console.info(
    `debt: ok, ${report.number_of_files} files, no new console.log, debugger, bare any or bare @ts-ignore`
  );
  return 0;
}

process.exitCode = main();
