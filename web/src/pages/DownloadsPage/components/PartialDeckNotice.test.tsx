import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartialDeckNotice } from './PartialDeckNotice';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

describe('PartialDeckNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('shows the neutral partial-deck copy with no pricing link', () => {
    render(<PartialDeckNotice />);
    expect(
      screen.getByText(
        /Only part of this page converted, so the rest is not in this deck\./
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /upgrade|pricing/i })).toBeNull();
  });

  it('fires the usage event on mount', () => {
    render(<PartialDeckNotice />);
    expect(track).toHaveBeenCalledWith('partial_deck_notice_shown');
  });

  it('renders a see-report control that calls the handler', () => {
    const onSeeReport = vi.fn();
    render(<PartialDeckNotice onSeeReport={onSeeReport} />);
    fireEvent.click(screen.getByRole('button', { name: 'See full report' }));
    expect(onSeeReport).toHaveBeenCalledTimes(1);
  });

  it('omits the see-report control when no handler is given', () => {
    render(<PartialDeckNotice />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
