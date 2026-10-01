import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorFlattenedNotice } from './ColorFlattenedNotice';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

describe('ColorFlattenedNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('uses singular copy for one coloured page', () => {
    render(<ColorFlattenedNotice count={1} />);
    expect(
      screen.getByText(/Text colors on 1 page of your PDF aren't in this deck/)
    ).toBeInTheDocument();
  });

  it('uses plural copy and the count for multiple coloured pages', () => {
    render(<ColorFlattenedNotice count={3} />);
    expect(
      screen.getByText(/Text colors on 3 pages of your PDF aren't in this deck/)
    ).toBeInTheDocument();
  });

  it('says "your decks" for a multi-deck batch upload', () => {
    render(<ColorFlattenedNotice count={4} multipleDecks />);
    expect(screen.getByText(/aren't in your decks/)).toBeInTheDocument();
  });

  it('fires the usage event with the coloured-page count on mount', () => {
    render(<ColorFlattenedNotice count={2} />);
    expect(track).toHaveBeenCalledWith('color_flatten_notice_shown', {
      colored_text_page_count: 2,
    });
  });
});
