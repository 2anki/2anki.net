import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoldedTogglesNotice } from './FoldedTogglesNotice';
import { track } from '../../../../lib/analytics/track';

vi.mock('../../../../lib/analytics/track', () => ({ track: vi.fn() }));

const renderNotice = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const ACTION = 'Make cards from the inner toggles too';

describe('FoldedTogglesNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('says how many toggles stayed inside other toggles', () => {
    renderNotice(<FoldedTogglesNotice count={3} onPromote={vi.fn()} />);

    expect(
      screen.getByText(
        "3 toggles were inside other toggles, so they didn't become cards of their own."
      )
    ).toBeInTheDocument();
  });

  it('calls onPromote when the button is clicked', () => {
    const onPromote = vi.fn();
    renderNotice(<FoldedTogglesNotice count={3} onPromote={onPromote} />);

    fireEvent.click(screen.getByRole('button', { name: ACTION }));

    expect(onPromote).toHaveBeenCalledTimes(1);
  });

  it('records one impression that says the button was offered', () => {
    renderNotice(<FoldedTogglesNotice count={3} onPromote={vi.fn()} />);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('folded_toggles_notice_shown', {
      count: 3,
      can_promote: true,
    });
  });

  it('names the card option the click turns on and that it stays on', () => {
    renderNotice(<FoldedTogglesNotice count={3} onPromote={vi.fn()} />);

    expect(
      screen.getByText(/The option stays on for your next uploads\./)
    ).toHaveTextContent(
      'This turns on “Nested toggles become their own cards”'
    );
  });

  it('leaves out the card limit line when the new deck counts toward none', () => {
    renderNotice(<FoldedTogglesNotice count={3} onPromote={vi.fn()} />);

    expect(
      screen.queryByText(/counts toward your monthly card limit/)
    ).not.toBeInTheDocument();
  });

  it('adds the card limit line when the new deck counts toward one', () => {
    renderNotice(
      <FoldedTogglesNotice count={3} onPromote={vi.fn()} countsTowardLimit />
    );

    expect(
      screen.getByText(/The new deck counts toward your monthly card limit\./)
    ).toHaveTextContent(
      /^The new deck counts toward your monthly card limit\.$/
    );
  });

  it('marks the button busy while the file goes back', () => {
    renderNotice(
      <FoldedTogglesNotice
        count={2}
        onPromote={vi.fn()}
        actionLabel="Checking sign in…"
        disabled
        busy
      />
    );

    const button = screen.getByRole('button', { name: 'Checking sign in…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('links to card options when the file cannot be sent again', () => {
    renderNotice(<FoldedTogglesNotice count={1} />);

    expect(
      screen.getByRole('link', {
        name: 'Turn on “Nested toggles become their own cards” in card options, then convert the file again',
      })
    ).toHaveAttribute('href', '/card-options?returnTo=/upload');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('records an impression without the button when only the link is offered', () => {
    renderNotice(<FoldedTogglesNotice count={1} />);

    expect(track).toHaveBeenCalledWith('folded_toggles_notice_shown', {
      count: 1,
      can_promote: false,
    });
  });
});
