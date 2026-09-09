import { describe, expect, it } from 'vitest';

import { ScoreRow, TodaySnapshotResponse } from './todayTypes';

describe('todayTypes', () => {
  it('describes the shape the server returns', () => {
    const row: ScoreRow = {
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
    };
    const snapshot: TodaySnapshotResponse = {
      rows: [row],
      as_of: '2026-09-09T10:00:00.000Z',
      cache_age_seconds: 0,
      stale: false,
      errors: [],
    };
    expect(snapshot.rows[0].status).toBe('red');
  });
});
