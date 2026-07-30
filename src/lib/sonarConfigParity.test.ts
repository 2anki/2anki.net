import fs from 'node:fs';
import path from 'node:path';

// Two Sonar configs exist and they are read by different scanners:
//   sonar-project.properties  — the local `sonar-scanner` CLI
//   .sonarcloud.properties    — SonarCloud Automatic Analysis (the PR-side scan)
// An exclusion or waiver added to only one is silently ignored by the other, so
// a "clean locally" run can coexist with a noisy PR scan. Found 2026-07-30:
// src/data_layer/public/** (kanel-generated) and the email-template waivers
// existed only in the CLI config, so the PR-side scan analysed all of it.
//
// Keys legitimately absent from .sonarcloud.properties, because Automatic
// Analysis does not use them: projectKey/organization come from the repo
// binding, lcov paths require a local coverage run, qualitygate.wait is CLI-only.
const CLI_ONLY_KEYS = new Set([
  'sonar.projectKey',
  'sonar.organization',
  'sonar.javascript.lcov.reportPaths',
  'sonar.qualitygate.wait',
]);

function parseProperties(relativePath: string): Map<string, string> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../..', relativePath),
    'utf8'
  );
  const entries = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    entries.set(
      trimmed.slice(0, separator).trim(),
      trimmed.slice(separator + 1).trim()
    );
  }
  return entries;
}

const cli = parseProperties('sonar-project.properties');
const autoScan = parseProperties('.sonarcloud.properties');

const asSet = (value: string | undefined): Set<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

describe('Sonar config parity between the CLI and Automatic Analysis', () => {
  it.each([
    'sonar.exclusions',
    'sonar.coverage.exclusions',
    'sonar.cpd.exclusions',
  ])('keeps %s identical in both files', (key) => {
    const onlyInCli = [...asSet(cli.get(key))].filter(
      (entry) => !asSet(autoScan.get(key)).has(entry)
    );
    const onlyInAutoScan = [...asSet(autoScan.get(key))].filter(
      (entry) => !asSet(cli.get(key)).has(entry)
    );

    expect({ onlyInCli, onlyInAutoScan }).toEqual({
      onlyInCli: [],
      onlyInAutoScan: [],
    });
  });

  it('declares the same rule waivers in both files', () => {
    const cliWaivers = asSet(cli.get('sonar.issue.ignore.multicriteria'));
    const autoScanWaivers = asSet(
      autoScan.get('sonar.issue.ignore.multicriteria')
    );

    expect([...cliWaivers].sort()).toEqual([...autoScanWaivers].sort());
  });

  it('gives every declared waiver a ruleKey and resourceKey in both files', () => {
    for (const [label, config] of [
      ['sonar-project.properties', cli],
      ['.sonarcloud.properties', autoScan],
    ] as const) {
      for (const waiver of asSet(
        config.get('sonar.issue.ignore.multicriteria')
      )) {
        expect({
          label,
          waiver,
          ruleKey: config.get(
            `sonar.issue.ignore.multicriteria.${waiver}.ruleKey`
          ),
          resourceKey: config.get(
            `sonar.issue.ignore.multicriteria.${waiver}.resourceKey`
          ),
        }).toEqual({
          label,
          waiver,
          ruleKey: expect.any(String),
          resourceKey: expect.any(String),
        });
      }
    }
  });

  it('leaves only the CLI-specific keys out of the Automatic Analysis config', () => {
    const missing = [...cli.keys()].filter(
      (key) => !autoScan.has(key) && !CLI_ONLY_KEYS.has(key)
    );

    expect(missing).toEqual([]);
  });

  it('points the CLI at the laer-smart project the repo is bound to', () => {
    // The repo moved orgs; the stale key pointed at a different project that
    // kept scanning main and had no quality gate, so nothing looked wrong.
    expect(cli.get('sonar.projectKey')).toBe('Laer-Smart_2anki.net');
    expect(cli.get('sonar.organization')).toBe('laer-smart');
  });
});
