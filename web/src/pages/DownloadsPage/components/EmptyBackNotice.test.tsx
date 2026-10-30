import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmptyBackNotice } from './EmptyBackNotice';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

describe('EmptyBackNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('uses singular copy for one skipped card', () => {
    render(<EmptyBackNotice count={1} />);
    expect(
      screen.getByText(
        /1 card had no answer and was skipped, so it isn't in this deck\./
      )
    ).toBeInTheDocument();
  });

  it('uses plural copy and the count for multiple skipped cards', () => {
    render(<EmptyBackNotice count={3} />);
    expect(
      screen.getByText(
        /3 cards had no answer and were skipped, so they aren't in this deck\./
      )
    ).toBeInTheDocument();
  });

  it('says "your decks" for a multi-deck batch upload', () => {
    render(<EmptyBackNotice count={4} multipleDecks />);
    expect(screen.getByText(/aren't in your decks/)).toBeInTheDocument();
  });

  it('fires the usage event with the empty-back count on mount', () => {
    render(<EmptyBackNotice count={2} />);
    expect(track).toHaveBeenCalledWith('empty_back_notice_shown', {
      empty_back_count: 2,
    });
  });

  it('tags the event when the notice sits on a My decks upload row', () => {
    render(<EmptyBackNotice count={4} surface="downloads_row" />);
    expect(track).toHaveBeenCalledWith('empty_back_notice_shown', {
      empty_back_count: 4,
      surface: 'downloads_row',
    });
  });
});
