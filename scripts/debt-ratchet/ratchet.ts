export const BASELINE_PATH = '.debt-ratchet-baseline.json';
export const DEBT_CONFIG_PATH = '.oxlintrc.debt.json';
export const MIN_JUSTIFICATION_WORDS = 3;

export const DEBT_KINDS = [
  'console-log',
  'debugger',
  'explicit-any',
  'ts-ignore',
] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];
export type DebtCounts = Record<DebtKind, Record<string, number>>;
export type DebtLines = Record<DebtKind, Record<string, number[]>>;

export interface OxlintDiagnostic {
  code: string;
  filename: string;
  labels: Array<{ span: { line: number; column: number } }>;
}

export interface OxlintReport {
  diagnostics: OxlintDiagnostic[];
  number_of_files: number;
}

export interface DebtFindings {
  counts: DebtCounts;
  lines: DebtLines;
}

export interface Growth {
  kind: DebtKind;
  file: string;
  count: number;
  allowed: number;
  lines: number[];
}

export interface Stale {
  kind: DebtKind;
  file: string;
  count: number;
  allowed: number;
}

const KIND_BY_RULE: ReadonlyMap<string, DebtKind> = new Map([
  ['eslint(no-console)', 'console-log'],
  ['eslint(no-debugger)', 'debugger'],
  ['typescript(no-explicit-any)', 'explicit-any'],
  ['typescript(ban-ts-comment)', 'ts-ignore'],
]);

const WHAT: Record<DebtKind, string> = {
  'console-log':
    'console.log (or another console method outside info/warn/error/debug)',
  debugger: 'debugger statement',
  'explicit-any': 'any without a same-line justification',
  'ts-ignore': '@ts-ignore without a same-line justification',
};

const FIX: Record<DebtKind, string> = {
  'console-log':
    'Log with console.info, console.warn, console.error or console.debug (the server logging convention), or delete the call',
  debugger: 'Delete the debugger statement',
  'explicit-any': `Use a real type, or unknown and narrow it. If any is unavoidable, end the line with a comment of at least ${MIN_JUSTIFICATION_WORDS} words saying why`,
  'ts-ignore': `Fix the type, or use @ts-expect-error. If @ts-ignore stays, follow it on the same line with at least ${MIN_JUSTIFICATION_WORDS} words saying why`,
};

export function emptyCounts(): DebtCounts {
  return {
    'console-log': {},
    debugger: {},
    'explicit-any': {},
    'ts-ignore': {},
  };
}

export function emptyLines(): DebtLines {
  return {
    'console-log': {},
    debugger: {},
    'explicit-any': {},
    'ts-ignore': {},
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word)).length;
}

function commentAfter(text: string): string | undefined {
  const lineComment = text.indexOf('//');
  const blockComment = text.indexOf('/*');
  const starts = [lineComment, blockComment].filter((index) => index >= 0);
  if (starts.length === 0) {
    return undefined;
  }
  return text
    .slice(Math.min(...starts) + 2)
    .replace(/\*\/.*$/, '')
    .trim();
}

export function isJustified(
  kind: DebtKind,
  lineText: string,
  column: number
): boolean {
  if (kind === 'explicit-any') {
    const comment = commentAfter(lineText.slice(Math.max(column - 1, 0)));
    return (
      comment !== undefined && countWords(comment) >= MIN_JUSTIFICATION_WORDS
    );
  }
  if (kind === 'ts-ignore') {
    const directive = lineText.indexOf('@ts-ignore');
    if (directive < 0) {
      return false;
    }
    const reason = lineText
      .slice(directive + '@ts-ignore'.length)
      .replace(/\*\/.*$/, '');
    return countWords(reason) >= MIN_JUSTIFICATION_WORDS;
  }
  return false;
}

export function collectDebt(
  diagnostics: OxlintDiagnostic[],
  readLine: (file: string, line: number) => string | undefined
): DebtFindings {
  const counts = emptyCounts();
  const lines = emptyLines();
  for (const diagnostic of diagnostics) {
    const kind = KIND_BY_RULE.get(diagnostic.code);
    const span = diagnostic.labels[0]?.span;
    if (kind === undefined || span === undefined) {
      continue;
    }
    const lineText = readLine(diagnostic.filename, span.line) ?? '';
    if (isJustified(kind, lineText, span.column)) {
      continue;
    }
    counts[kind][diagnostic.filename] =
      (counts[kind][diagnostic.filename] ?? 0) + 1;
    lines[kind][diagnostic.filename] = [
      ...(lines[kind][diagnostic.filename] ?? []),
      span.line,
    ];
  }
  return { counts, lines };
}

export function compareToBaseline(
  baseline: DebtCounts,
  findings: DebtFindings
): { grown: Growth[]; stale: Stale[] } {
  const grown: Growth[] = [];
  const stale: Stale[] = [];
  for (const kind of DEBT_KINDS) {
    const current = findings.counts[kind];
    const allowedByFile = baseline[kind];
    for (const file of Object.keys(current).sort()) {
      const allowed = allowedByFile[file] ?? 0;
      if (current[file] > allowed) {
        grown.push({
          kind,
          file,
          count: current[file],
          allowed,
          lines: findings.lines[kind][file] ?? [],
        });
      }
    }
    for (const file of Object.keys(allowedByFile).sort()) {
      const count = current[file] ?? 0;
      if (count < allowedByFile[file]) {
        stale.push({ kind, file, count, allowed: allowedByFile[file] });
      }
    }
  }
  return { grown, stale };
}

export function shrinkBaseline(
  baseline: DebtCounts,
  current: DebtCounts
): DebtCounts {
  const shrunk = emptyCounts();
  for (const kind of DEBT_KINDS) {
    for (const file of Object.keys(baseline[kind]).sort()) {
      const kept = Math.min(baseline[kind][file], current[kind][file] ?? 0);
      if (kept > 0) {
        shrunk[kind][file] = kept;
      }
    }
  }
  return shrunk;
}

export function totals(counts: DebtCounts): Record<DebtKind, number> {
  const sum = (byFile: Record<string, number>) =>
    Object.values(byFile).reduce((total, n) => total + n, 0);
  return {
    'console-log': sum(counts['console-log']),
    debugger: sum(counts.debugger),
    'explicit-any': sum(counts['explicit-any']),
    'ts-ignore': sum(counts['ts-ignore']),
  };
}

export function formatGrowth(growth: Growth): string {
  return `debt: FAILED, ${growth.file}:${growth.lines.join(',')} has ${growth.count} ${WHAT[growth.kind]}, the baseline allows ${growth.allowed}. ${FIX[growth.kind]}.`;
}

export function formatStale(stale: Stale): string {
  return `debt: ${stale.file} has ${stale.count} ${WHAT[stale.kind]}, the baseline still allows ${stale.allowed}. Not a failure; run pnpm debt:shrink and commit ${BASELINE_PATH}.`;
}

function isRecordOfCounts(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((n) => Number.isInteger(n) && n > 0)
  );
}

export function parseBaseline(json: string): DebtCounts {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${BASELINE_PATH} is not an object of debt kinds`);
  }
  const baseline = emptyCounts();
  for (const [kind, byFile] of Object.entries(parsed)) {
    const known = DEBT_KINDS.find((candidate) => candidate === kind);
    if (known === undefined || !isRecordOfCounts(byFile)) {
      throw new Error(
        `${BASELINE_PATH} has an unknown kind or a bad count under "${kind}"`
      );
    }
    baseline[known] = byFile;
  }
  return baseline;
}

export function serializeBaseline(baseline: DebtCounts): string {
  const sorted: Record<string, Record<string, number>> = {};
  for (const kind of DEBT_KINDS) {
    sorted[kind] = Object.fromEntries(
      Object.entries(baseline[kind]).sort(([a], [b]) => a.localeCompare(b))
    );
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function parseOxlintReport(stdout: string): OxlintReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`oxlint printed no JSON report: ${stdout.slice(0, 300)}`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('diagnostics' in parsed) ||
    !Array.isArray(parsed.diagnostics) ||
    !('number_of_files' in parsed) ||
    typeof parsed.number_of_files !== 'number'
  ) {
    throw new Error(
      'oxlint printed JSON without diagnostics or number_of_files'
    );
  }
  return {
    diagnostics: parsed.diagnostics as OxlintDiagnostic[],
    number_of_files: parsed.number_of_files,
  };
}
