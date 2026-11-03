import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoldedTogglesNotice } from './FoldedTogglesNotice';
import { track } from '../../../../lib/analytics/track';

vi.mock('../../../../lib/analytics/track', () => ({ track: vi.fn() }));

const renderNotice = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('FoldedTogglesNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('offers one click to make each nested toggle its own card', () => {
    const onPromote = vi.fn();
    renderNotice(<FoldedTogglesNotice count={3} onPromote={onPromote} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Make cards from the inner toggles too',
      })
    );

    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        '3 toggles were inside other toggles. They went on the back of the outer cards instead of becoming cards of their own.'
      )
    ).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('folded_toggles_notice_shown', {
      count: 3,
      can_promote: true,
    });
    expect(
      screen.getByText(/Your next uploads will do this too\./)
    ).toHaveTextContent('(“Nested toggles become their own cards”)');
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
    expect(track).toHaveBeenCalledWith('folded_toggles_notice_shown', {
      count: 1,
      can_promote: false,
    });
  });
});
