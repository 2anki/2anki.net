import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import Scoreboard from './Scoreboard';
import { ScoreRow, TodaySnapshotResponse } from './todayTypes';

const row = (overrides: Partial<ScoreRow>): ScoreRow => ({
  id: 'row',
  lever: 'revenue',
  label: 'Row',
  format: 'count',
  window_label: '7d',
  value: 1,
  delta: null,
  delta_good: null,
  target: null,
  target_direction: null,
  status: 'none',
  link: '/ops/business',
  ...overrides,
});

const snapshot = (rows: ScoreRow[]): TodaySnapshotResponse => ({
  rows,
  as_of: '2026-09-09T10:00:00.000Z',
  cache_age_seconds: 0,
  stale: false,
  errors: [],
});

const renderBoard = (props: Parameters<typeof Scoreboard>[0]) =>
  render(
    <MemoryRouter>
      <Scoreboard {...props} />
    </MemoryRouter>
  );

describe('Scoreboard', () => {
  test('shows the loading hint before the first snapshot', () => {
    renderBoard({ snapshot: undefined, error: null, isLoading: true });
    expect(screen.getByText('Reading the scoreboard')).toBeInTheDocument();
  });

  test('colours the delta by whether it moved the right way', () => {
    renderBoard({
      snapshot: snapshot([
        row({
          id: 'failed_payments_week',
          label: 'Failed payments',
          value: 9,
          delta: 7,
          delta_good: false,
          target: 4,
          target_direction: 'at_most',
          status: 'red',
        }),
        row({
          id: 'churn_30d_pct',
          label: 'Churn',
          format: 'percent',
          value: 6.5,
          delta: -0.5,
          delta_good: true,
          target: 7,
          target_direction: 'at_most',
          status: 'green',
        }),
      ]),
      error: null,
      isLoading: false,
    });
    expect(screen.getByText('+7')).toHaveAttribute('data-good', 'false');
    expect(screen.getByText('−0.5 pts')).toHaveAttribute('data-good', 'true');
    expect(screen.getByText('≤4')).toBeInTheDocument();
    expect(screen.getByText('≤7.0%')).toBeInTheDocument();
  });

  test('omits the divider when every row needs attention', () => {
    const { container } = renderBoard({
      snapshot: snapshot([
        row({ id: 'a', status: 'red' }),
        row({ id: 'b', status: 'amber' }),
      ]),
      error: null,
      isLoading: false,
    });
    expect(screen.getByText('2 need attention')).toBeInTheDocument();
    expect(container.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(
      1
    );
  });
});
