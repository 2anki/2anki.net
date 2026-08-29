import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import '../../../lib/i18n';
import { track } from '../../../lib/analytics/track';
import {
  NotionEmptyToggleNotice,
  shouldShowEmptyToggleNotice,
} from './NotionEmptyToggleNotice';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

const mockTrack = vi.mocked(track);

describe('NotionEmptyToggleNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says how many toggles were empty and how many cards were made', () => {
    render(
      <NotionEmptyToggleNotice skipped={14} cards={9} onSeeReport={vi.fn()} />
    );

    expect(
      screen.getByText(
        '14 of your toggles had no answer inside, so only 9 cards were made. Add the answer inside each toggle, then convert again.'
      )
    ).toBeInTheDocument();
  });

  it('uses the singular when exactly one card was made', () => {
    render(
      <NotionEmptyToggleNotice skipped={5} cards={1} onSeeReport={vi.fn()} />
    );

    expect(
      screen.getByText(
        '5 of your toggles had no answer inside, so only 1 card was made. Add the answer inside each toggle, then convert again.'
      )
    ).toBeInTheDocument();
  });

  it('opens the report from its own link', () => {
    const onSeeReport = vi.fn();
    render(
      <NotionEmptyToggleNotice
        skipped={14}
        cards={9}
        onSeeReport={onSeeReport}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'See full report' }));

    expect(onSeeReport).toHaveBeenCalledTimes(1);
  });

  it('fires the empty-back event once with the downloads surface', () => {
    render(
      <NotionEmptyToggleNotice skipped={14} cards={9} onSeeReport={vi.fn()} />
    );

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('empty_back_notice_shown', {
      empty_back_count: 14,
      surface: 'downloads_notion',
    });
  });
});

describe('shouldShowEmptyToggleNotice', () => {
  it.each([
    [14, 9, true],
    [9, 9, true],
    [8, 9, false],
    [1, 40, false],
    [0, 9, false],
    [5, 0, false],
    [undefined, 9, false],
    [5, null, false],
  ])('empty %s vs cards %s → %s', (skipped, cards, expected) => {
    expect(shouldShowEmptyToggleNotice(skipped, cards)).toBe(expected);
  });
});
