import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  BASELINE_PATH,
  DEBT_CONFIG_PATH,
  collectDebt,
  collectDisableDirectives,
  compareToBaseline,
  formatGrowth,
  formatStale,
  formatSummary,
  isLintedPath,
  mergeFindings,
  parseBaseline,
  parseOxlintReport,
  serializeBaseline,
  shrinkBaseline,
  totals,
} from './ratchet';

const LINTED_PATHS = ['src', 'web/src'];
const MIN_FILES = 2500;

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  return result.stdout;
}

function requireFloor(what: string, count: number) {
  if (count < MIN_FILES) {
    throw new Error(
      `${what} covered ${count} files, below the floor of ${MIN_FILES}. Check ignorePatterns in ${DEBT_CONFIG_PATH}`
    );
  }
}

function lintForDebt() {
  const report = parseOxlintReport(
    run(process.env.OXLINT ?? 'oxlint', [
      '-c',
      DEBT_CONFIG_PATH,
      '--format',
      'json',
      ...LINTED_PATHS,
    ])
  );
  requireFloor('oxlint', report.number_of_files);
  return report;
}

function lintedFiles(): string[] {
  const config: { ignorePatterns: string[] } = JSON.parse(
    readFileSync(DEBT_CONFIG_PATH, 'utf8')
  );
  const files = run('git', [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    ...LINTED_PATHS,
  ])
    .split('\0')
    .filter((file) => file !== '' && isLintedPath(file, config.ignorePatterns));
  requireFloor('the disable-comment scan', files.length);
  return files;
}

function main(): number {
  const report = lintForDebt();
  const fileText = new Map<string, string>();
  const read = (file: string) => {
    const cached = fileText.get(file);
    if (cached !== undefined) {
      return cached;
    }
    const text = readFileSync(file, 'utf8');
    fileText.set(file, text);
    return text;
  };
  const findings = mergeFindings(
    collectDebt(
      report.diagnostics,
      (file, line) => read(file).split('\n')[line - 1]
    ),
    collectDisableDirectives(
      lintedFiles().map((path) => ({ path, text: read(path) }))
    )
  );
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
    console.error(formatSummary(grown.length));
    return 1;
  }
  console.info(
    `debt: ok, ${report.number_of_files} files, no new console.log, debugger, bare any, bare @ts-ignore or disable comment for them`
  );
  return 0;
}

process.exitCode = main();
