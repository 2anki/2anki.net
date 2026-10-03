import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import '../../../lib/i18n';
import { track } from '../../../lib/analytics/track';
import { ThinDeckNotice, shouldShowThinDeckNotice } from './ThinDeckNotice';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

const mockTrack = vi.mocked(track);

describe('ThinDeckNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tells empty-toggle authors to add an answer inside each toggle', () => {
    render(
      <ThinDeckNotice
        reason="emptyToggles"
        skipped={14}
        cards={9}
        onSeeReport={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'Only 9 cards came from this page. 14 toggles had no answer inside and were skipped — add an answer inside each, then convert again.'
      )
    ).toBeInTheDocument();
  });

  it('tells not-connected authors to add 2anki under Connections', () => {
    render(
      <ThinDeckNotice
        reason="notConnected"
        skipped={6}
        cards={2}
        onSeeReport={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        "Only 2 cards came from this page. 6 parts aren't connected to 2anki and were skipped — in Notion, add 2anki to this page and its sub-pages under Connections, then convert again."
      )
    ).toBeInTheDocument();
  });

  it('points mixed skips at the full report', () => {
    render(
      <ThinDeckNotice
        reason="generic"
        skipped={5}
        cards={3}
        onSeeReport={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'Only 3 cards came from this page, and 5 parts were skipped. Open the report to see why.'
      )
    ).toBeInTheDocument();
  });

  it('uses the singular card wording when exactly one card was made', () => {
    render(
      <ThinDeckNotice
        reason="emptyToggles"
        skipped={5}
        cards={1}
        onSeeReport={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'Only 1 card came from this page. 5 toggles had no answer inside and were skipped — add an answer inside each, then convert again.'
      )
    ).toBeInTheDocument();
  });

  it('opens the report from its own dialog-opening button', () => {
    const onSeeReport = vi.fn();
    render(
      <ThinDeckNotice
        reason="generic"
        skipped={5}
        cards={3}
        onSeeReport={onSeeReport}
      />
    );

    const button = screen.getByRole('button', { name: 'See full report' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(button);
    expect(onSeeReport).toHaveBeenCalledTimes(1);
  });

  it('fires the thin-deck event once with the reason, cards, skipped and downloads surface', () => {
    render(
      <ThinDeckNotice
        reason="notConnected"
        skipped={6}
        cards={2}
        onSeeReport={vi.fn()}
      />
    );

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('thin_deck_notice_shown', {
      reason: 'notConnected',
      cards: 2,
      skipped: 6,
      surface: 'downloads',
    });
  });

  it('renders the paying few-cards copy without a report button', () => {
    render(
      <ThinDeckNotice
        reason="fewCards"
        skipped={0}
        cards={2}
        surface="upload"
      />
    );

    expect(
      screen.getByText(
        'Only 2 cards came from this file. Turn on Claude cards above and convert again to get more.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the paid-AI few-cards copy without a report button', () => {
    render(
      <ThinDeckNotice
        reason="fewCardsPaidAi"
        skipped={0}
        cards={2}
        surface="upload"
      />
    );

    expect(
      screen.getByText(
        'Only 2 cards came from this file. Claude can write more cards from it on a paid plan.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('uses the singular few-cards wording for exactly one card', () => {
    render(
      <ThinDeckNotice
        reason="fewCards"
        skipped={0}
        cards={1}
        surface="upload"
      />
    );

    expect(
      screen.getByText(
        'Only 1 card came from this file. Turn on Claude cards above and convert again to get more.'
      )
    ).toBeInTheDocument();
  });

  it('tags the analytics event with the upload surface', () => {
    render(
      <ThinDeckNotice
        reason="fewCards"
        skipped={0}
        cards={2}
        surface="upload"
      />
    );

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('thin_deck_notice_shown', {
      reason: 'fewCards',
      cards: 2,
      skipped: 0,
      surface: 'upload',
    });
  });
});

describe('shouldShowThinDeckNotice', () => {
  it.each([
    [14, 9, true],
    [9, 9, true],
    [2, 2, true],
    [8, 9, false],
    [1, 40, false],
    [1, 1, false],
    [2, 3, false],
    [0, 9, false],
    [5, 0, false],
  ])(
    'candidateSkips %s vs cards %s → %s',
    (candidateSkips, cards, expected) => {
      expect(shouldShowThinDeckNotice(candidateSkips, cards)).toBe(expected);
    }
  );
});
