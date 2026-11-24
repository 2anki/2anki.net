import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BASELINE_PATH,
  DEBT_CONFIG_PATH,
  collectDebt,
  compareToBaseline,
  emptyCounts,
  emptyLines,
  formatGrowth,
  formatStale,
  isJustified,
  parseBaseline,
  parseOxlintReport,
  shrinkBaseline,
  totals,
} from './ratchet';
import type { DebtCounts, OxlintDiagnostic } from './ratchet';

const repoRoot = path.resolve(__dirname, '../..');

const KNOWN_LAYER_SKIP_CEILING = 292;
const DEBT_CEILINGS = {
  'console-log': 99,
  debugger: 0,
  'explicit-any': 242,
  'ts-ignore': 5,
};

function counts(partial: Partial<DebtCounts>): DebtCounts {
  return { ...emptyCounts(), ...partial };
}

function diagnostic(
  code: string,
  filename: string,
  line: number,
  column: number
): OxlintDiagnostic {
  return { code, filename, labels: [{ span: { line, column } }] };
}

describe('isJustified', () => {
  it.each([
    ['explicit-any', 'const x = y as any;', 15, false],
    ['explicit-any', 'const x = y as any; // vendor type', 15, false],
    [
      'explicit-any',
      'const x = y as any; // vendor types omit this field',
      15,
      true,
    ],
    [
      'explicit-any',
      'const x = y as any; /* vendor types omit it */',
      15,
      true,
    ],
    ['explicit-any', "const x = ('http://a b c d' as any);", 30, false],
    ['ts-ignore', '// @ts-ignore', 1, false],
    ['ts-ignore', '// @ts-ignore: wrong', 1, false],
    [
      'ts-ignore',
      '// @ts-ignore — Express request does not declare files',
      1,
      true,
    ],
    ['console-log', "console.log('a reason is not enough here');", 1, false],
    ['debugger', 'debugger; // three words here', 1, false],
  ] as const)('%s on %j is %s', (kind, lineText, column, expected) => {
    expect(isJustified(kind, lineText, column)).toBe(expected);
  });
});

describe('collectDebt', () => {
  it('counts unjustified findings per file and records their lines', () => {
    const lines: Record<string, string[]> = {
      'src/a.ts': [
        'console.log(1);',
        'const x = y as any;',
        'const z = w as any; // the SDK types omit it',
      ],
      'src/b.ts': ['// @ts-ignore'],
    };
    const findings = collectDebt(
      [
        diagnostic('eslint(no-console)', 'src/a.ts', 1, 1),
        diagnostic('typescript(no-explicit-any)', 'src/a.ts', 2, 16),
        diagnostic('typescript(no-explicit-any)', 'src/a.ts', 3, 16),
        diagnostic('typescript(ban-ts-comment)', 'src/b.ts', 1, 1),
        diagnostic('eslint(no-unused-vars)', 'src/b.ts', 1, 1),
      ],
      (file, line) => lines[file][line - 1]
    );

    expect(findings.counts).toEqual(
      counts({
        'console-log': { 'src/a.ts': 1 },
        'explicit-any': { 'src/a.ts': 1 },
        'ts-ignore': { 'src/b.ts': 1 },
      })
    );
    expect(findings.lines['explicit-any']).toEqual({ 'src/a.ts': [2] });
  });
});

describe('compareToBaseline', () => {
  it('reports a file whose count rose and a file that is not in the baseline', () => {
    const baseline = counts({ 'console-log': { 'src/a.ts': 1 } });
    const result = compareToBaseline(baseline, {
      counts: counts({ 'console-log': { 'src/a.ts': 2, 'src/new.ts': 1 } }),
      lines: {
        ...emptyLines(),
        'console-log': { 'src/a.ts': [3, 9], 'src/new.ts': [4] },
      },
    });

    expect(result.grown).toEqual([
      {
        kind: 'console-log',
        file: 'src/a.ts',
        count: 2,
        allowed: 1,
        lines: [3, 9],
      },
      {
        kind: 'console-log',
        file: 'src/new.ts',
        count: 1,
        allowed: 0,
        lines: [4],
      },
    ]);
    expect(result.stale).toEqual([]);
  });

  it('reports a file whose count fell as stale, not grown', () => {
    const baseline = counts({
      'explicit-any': { 'src/a.ts': 3, 'src/gone.ts': 1 },
    });
    const result = compareToBaseline(baseline, {
      counts: counts({ 'explicit-any': { 'src/a.ts': 2 } }),
      lines: emptyLines(),
    });

    expect(result.grown).toEqual([]);
    expect(result.stale).toEqual([
      { kind: 'explicit-any', file: 'src/a.ts', count: 2, allowed: 3 },
      { kind: 'explicit-any', file: 'src/gone.ts', count: 0, allowed: 1 },
    ]);
  });
});

describe('shrinkBaseline', () => {
  it('lowers counts to what is left, drops fixed files and never adds or raises', () => {
    const baseline = counts({
      'console-log': { 'src/a.ts': 3, 'src/b.ts': 1, 'src/c.ts': 1 },
    });
    const current = counts({
      'console-log': { 'src/a.ts': 2, 'src/c.ts': 5, 'src/new.ts': 1 },
    });

    expect(shrinkBaseline(baseline, current)).toEqual(
      counts({ 'console-log': { 'src/a.ts': 2, 'src/c.ts': 1 } })
    );
  });
});

describe('messages', () => {
  it('names the file, the lines and the fix when debt grows', () => {
    const message = formatGrowth({
      kind: 'explicit-any',
      file: 'src/a.ts',
      count: 2,
      allowed: 1,
      lines: [3, 9],
    });

    expect(message).toContain('src/a.ts:3,9');
    expect(message).toContain('unknown');
    expect(message).toContain('at least 3 words');
  });

  it('tells the author how to lower a stale baseline', () => {
    expect(
      formatStale({
        kind: 'console-log',
        file: 'src/a.ts',
        count: 0,
        allowed: 2,
      })
    ).toContain('pnpm debt:shrink');
  });
});

describe('parsers', () => {
  it('rejects a baseline with an unknown kind', () => {
    expect(() => parseBaseline('{"console-logs": {}}')).toThrow(/console-logs/);
  });

  it('rejects oxlint output that is not a report', () => {
    expect(() => parseOxlintReport('Cannot find native binding')).toThrow(
      /oxlint/
    );
  });
});

describe('the debt oxlint config', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'debt-ratchet-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('flags console.log, debugger, a bare any and a bare @ts-ignore but not the logging methods', () => {
    const source = [
      "console.log('a');",
      "console.info('b');",
      "console.warn('c');",
      "console.error('d');",
      "console.debug('e');",
      'debugger;',
      'export const x = 1 as any;',
      '// @ts-ignore',
      'export const y: number = 2;',
      '// @ts-expect-error the next line is wrong on purpose',
      "export const z: number = 'z';",
    ].join('\n');
    writeFileSync(path.join(dir, 'sample.ts'), source);

    const result = spawnSync(
      path.join(repoRoot, 'node_modules/.bin/oxlint'),
      [
        '-c',
        path.join(repoRoot, DEBT_CONFIG_PATH),
        '--format',
        'json',
        'sample.ts',
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    const report = parseOxlintReport(result.stdout);
    const sourceLines = source.split('\n');
    const findings = collectDebt(
      report.diagnostics,
      (_file, line) => sourceLines[line - 1]
    );

    expect(totals(findings.counts)).toEqual({
      'console-log': 1,
      debugger: 1,
      'explicit-any': 1,
      'ts-ignore': 1,
    });
  });

  it('ignores the same paths as the main lint config', () => {
    const read = (file: string) =>
      JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));

    expect(read(DEBT_CONFIG_PATH).ignorePatterns).toEqual(
      read('.oxlintrc.json').ignorePatterns
    );
  });
});

describe('the committed baselines only shrink', () => {
  it('the debt baseline stays at or under its ceiling', () => {
    const baseline = parseBaseline(
      readFileSync(path.join(repoRoot, BASELINE_PATH), 'utf8')
    );

    for (const [kind, total] of Object.entries(totals(baseline))) {
      expect(
        total,
        `${kind} in ${BASELINE_PATH} grew past its ceiling. The baseline may only shrink; fix the new site instead`
      ).toBeLessThanOrEqual(DEBT_CEILINGS[kind as keyof typeof DEBT_CEILINGS]);
    }
  });

  it('the layer-skip known violations stay at or under their ceiling', () => {
    const known: unknown[] = JSON.parse(
      readFileSync(
        path.join(repoRoot, '.dependency-cruiser-known-violations.json'),
        'utf8'
      )
    );

    expect(
      known.length,
      '.dependency-cruiser-known-violations.json grew. It may only shrink; route the new import through a use case or service'
    ).toBeLessThanOrEqual(KNOWN_LAYER_SKIP_CEILING);
  });

  it('the layer-skip known violations hold no other rule', () => {
    const known: Array<{ rule: { name: string } }> = JSON.parse(
      readFileSync(
        path.join(repoRoot, '.dependency-cruiser-known-violations.json'),
        'utf8'
      )
    );

    expect(new Set(known.map((entry) => entry.rule.name))).toEqual(
      new Set(['no-layer-skip-to-data-layer'])
    );
  });
});
