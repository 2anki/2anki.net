import { describe, expect, it } from 'vitest';

import {
  buildScoreCopyText,
  describeDelta,
  formatScoreDelta,
  formatScoreTarget,
  formatScoreValue,
  needsAttention,
} from './todayScore';
import { ScoreRow } from './todayTypes';

const row = (overrides: Partial<ScoreRow> = {}): ScoreRow => ({
  id: 'new_paid_7d',
  lever: 'revenue',
  label: 'New paid',
  format: 'count',
  window_label: '7d',
  value: 15,
  delta: null,
  delta_good: null,
  target: 70,
  target_direction: 'at_least',
  status: 'red',
  link: '/ops/business',
  ...overrides,
});

describe('todayScore formatting', () => {
  it('formats counts with a thin space and percents with one decimal', () => {
    expect(formatScoreValue(row({ value: 12450 }))).toBe('12 450');
    expect(formatScoreValue(row({ format: 'percent', value: 88.25 }))).toBe(
      '88.3%'
    );
    expect(formatScoreValue(row({ value: null }))).toBe('—');
  });

  it('prefixes the target with its direction', () => {
    expect(formatScoreTarget(row())).toBe('≥70');
    expect(
      formatScoreTarget(
        row({ format: 'percent', target: 7, target_direction: 'at_most' })
      )
    ).toBe('≤7.0%');
    expect(
      formatScoreTarget(row({ target: 4.5, target_direction: 'at_most' }))
    ).toBe('≤4.5');
    expect(formatScoreTarget(row({ target: null }))).toBe('—');
  });

  it('signs the delta and uses points for percents', () => {
    expect(formatScoreDelta(row({ delta: 7 }))).toBe('+7');
    expect(formatScoreDelta(row({ delta: -3 }))).toBe('−3');
    expect(formatScoreDelta(row({ delta: 0 }))).toBe('±0');
    expect(formatScoreDelta(row({ format: 'percent', delta: -2.25 }))).toBe(
      '−2.3 pts'
    );
    expect(formatScoreDelta(row({ delta: null }))).toBe('—');
  });

  it('describes the delta for screen readers with its direction', () => {
    expect(describeDelta(row({ delta: 7, delta_good: false }))).toBe(
      'change +7, worse'
    );
    expect(
      describeDelta(row({ format: 'percent', delta: -0.5, delta_good: true }))
    ).toBe('change minus 0.5 pts, better');
    expect(describeDelta(row({ delta: null }))).toBe('no change data');
  });

  it('treats red and amber as needing attention', () => {
    expect(needsAttention(row({ status: 'red' }))).toBe(true);
    expect(needsAttention(row({ status: 'amber' }))).toBe(true);
    expect(needsAttention(row({ status: 'green' }))).toBe(false);
    expect(needsAttention(row({ status: 'none' }))).toBe(false);
  });

  it('builds a triage prompt with value, target, and the detail link', () => {
    const text = buildScoreCopyText(row({ delta: -4 }));
    expect(text).toContain('## New paid — triage request');
    expect(text).toContain('Value: 15 (target ≥70, change −4).');
    expect(text).toContain('Detail: /ops/business');
  });
});
