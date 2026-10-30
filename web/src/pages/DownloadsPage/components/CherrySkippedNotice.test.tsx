import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CherrySkippedNotice } from './CherrySkippedNotice';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

const LINK = 'Change Cherry-pick in card options';

describe('CherrySkippedNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('links back to My decks and records the downloads surface by default', () => {
    render(
      <MemoryRouter>
        <CherrySkippedNotice count={3} />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: LINK })).toHaveAttribute(
      'href',
      '/card-options?returnTo=/downloads'
    );
    expect(track).toHaveBeenCalledWith('cherry_skipped_notice_shown', {
      skipped: 3,
      returnTo: '/downloads',
    });
  });

  it('links back to the upload page and records the upload surface there', () => {
    render(
      <MemoryRouter>
        <CherrySkippedNotice count={5} returnTo="/upload" />
      </MemoryRouter>
    );

    expect(
      screen.getByText(
        'Cherry-pick is on, so 5 toggles without a 🍒 were left out of this deck.',
        { exact: false }
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: LINK })).toHaveAttribute(
      'href',
      '/card-options?returnTo=/upload'
    );
    expect(track).toHaveBeenCalledWith('cherry_skipped_notice_shown', {
      skipped: 5,
      returnTo: '/upload',
    });
  });
});
