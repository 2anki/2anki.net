import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CancelFunnelChart from './CancelFunnelChart';
import { CancelFunnelResponse } from '../cancelFunnelTypes';

const buildData = (
  overrides?: Partial<CancelFunnelResponse>
): CancelFunnelResponse => ({
  stages: {
    cancel_started: 100,
    cancelled: 70,
  },
  since: '2026-06-18T00:00:00.000Z',
  as_of: '2026-07-18T00:00:00.000Z',
  ...overrides,
});

describe('CancelFunnelChart', () => {
  it('renders each stage count', () => {
    render(<CancelFunnelChart data={buildData()} />);

    expect(screen.getByText('cancel started')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
  });

  it('shows no pause rows or pause save-rate', () => {
    render(<CancelFunnelChart data={buildData()} />);

    expect(screen.queryByText(/pause/i)).toBeNull();
    expect(screen.queryByText(/saved/)).toBeNull();
  });

  it('shows an empty message when there are no stages', () => {
    render(<CancelFunnelChart data={{ ...buildData(), stages: null }} />);

    expect(
      screen.getByText('No cancellations recorded yet.')
    ).toBeInTheDocument();
  });
});
