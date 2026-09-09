import { formatCount, formatPercent } from './opsHelpers';
import { ScoreRow, ScoreStatus } from './todayTypes';

const formatNumber = (row: ScoreRow, value: number): string =>
  row.format === 'percent' ? formatPercent(value) : formatCount(value);

export const formatScoreValue = (row: ScoreRow): string =>
  row.value == null ? '—' : formatNumber(row, row.value);

export const formatScoreTarget = (row: ScoreRow): string => {
  if (row.target == null || row.target_direction == null) return '—';
  const prefix = row.target_direction === 'at_least' ? '≥' : '≤';
  const rounded = Number.isInteger(row.target)
    ? row.target
    : Number(row.target.toFixed(1));
  return `${prefix}${formatNumber(row, rounded)}`;
};

export const formatScoreDelta = (row: ScoreRow): string => {
  if (row.delta == null) return '—';
  if (row.delta === 0) return '±0';
  const sign = row.delta > 0 ? '+' : '−';
  const magnitude = Math.abs(row.delta);
  const body =
    row.format === 'percent'
      ? `${magnitude.toFixed(1)} pts`
      : formatCount(Number(magnitude.toFixed(1)));
  return `${sign}${body}`;
};

export const NEEDS_ATTENTION: ReadonlySet<ScoreStatus> = new Set([
  'red',
  'amber',
]);

export const needsAttention = (row: ScoreRow): boolean =>
  NEEDS_ATTENTION.has(row.status);

export const buildScoreCopyText = (row: ScoreRow): string =>
  [
    `## ${row.label} — triage request`,
    '',
    `- Status: ${row.status}, window ${row.window_label}.`,
    `- Value: ${formatScoreValue(row)} (target ${formatScoreTarget(row)}, change ${formatScoreDelta(row)}).`,
    `- Detail: ${row.link}`,
    '',
    'Repo: 2anki/server. Investigate the likely cause and propose the smallest fix.',
  ].join('\n');
