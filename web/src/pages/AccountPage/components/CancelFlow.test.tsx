import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelFlow } from './CancelFlow';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

const renderFlow = (
  overrides: Partial<Parameters<typeof CancelFlow>[0]> = {}
) => {
  const props = {
    planLabel: 'Monthly',
    tenureDays: 10,
    pauseEligible: false,
    isLegacyRate: false,
    isCancelling: false,
    isPausing: false,
    pauseError: '',
    onCancel: vi.fn(),
    onKeep: vi.fn(),
    onPause: vi.fn(),
    ...overrides,
  };
  render(<CancelFlow {...props} />);
  return props;
};

beforeEach(() => {
  vi.mocked(track).mockClear();
});

describe('CancelFlow comment capture', () => {
  it('shows no comment box until a reason is chosen', () => {
    renderFlow();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('passes the typed comment to onCancel', () => {
    const { onCancel } = renderFlow();

    fireEvent.click(screen.getByLabelText('Technical issues'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  the deck came out empty  ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel subscription' })
    );

    expect(onCancel).toHaveBeenCalledWith(
      'Technical issues',
      'the deck came out empty'
    );
  });

  it('passes the comment to onKeep as well', () => {
    const { onKeep } = renderFlow();

    fireEvent.click(screen.getByLabelText('Too expensive'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'student budget' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep subscription' }));

    expect(onKeep).toHaveBeenCalledWith('Too expensive', 'student budget');
  });

  it('cancels with an empty comment when the box is left blank', () => {
    const { onCancel } = renderFlow();

    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel subscription' })
    );

    expect(onCancel).toHaveBeenCalledWith('Other', '');
  });

  it('uses the reason-aware placeholder for technical issues', () => {
    renderFlow();

    fireEvent.click(screen.getByLabelText('Technical issues'));
    expect(
      screen.getByPlaceholderText('What broke? (optional)')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Too expensive'));
    expect(
      screen.getByPlaceholderText("Anything you'd like to add? (optional)")
    ).toBeInTheDocument();
  });
});

describe('CancelFlow pause-first ordering', () => {
  it('shows the pause card on open for an eligible sub with no reason selected', () => {
    renderFlow({ pauseEligible: true });

    expect(
      screen.getByRole('button', { name: 'Pause subscription' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Too expensive' })
    ).not.toBeChecked();
  });

  it('fires subscription_pause_offered on mount when pause is shown', () => {
    renderFlow({ pauseEligible: true, tenureDays: 42 });

    expect(track).toHaveBeenCalledWith('subscription_pause_offered', {
      tenure_days: 42,
    });
  });

  it('does not offer pause when the sub is not eligible', () => {
    renderFlow({ pauseEligible: false });

    expect(track).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Pause subscription' })
    ).not.toBeInTheDocument();
  });

  it('pauses with no reason selected and fires subscription_paused', () => {
    const { onPause } = renderFlow({ pauseEligible: true, tenureDays: 42 });

    fireEvent.click(screen.getByRole('button', { name: '2 months' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause subscription' }));

    expect(track).toHaveBeenCalledWith('subscription_paused', {
      pause_months: 2,
      tenure_days: 42,
    });
    expect(onPause).toHaveBeenCalledWith(2, '');
  });

  it('keeps the reason list and cancel button visible below the pause card', () => {
    renderFlow({ pauseEligible: true });

    expect(screen.getByText('Still want to cancel?')).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Too expensive' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Cancel subscription' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Keep subscription' })
    ).toBeInTheDocument();
  });

  it('renders todays flow with no pause card or new heading when ineligible', () => {
    renderFlow({ pauseEligible: false });

    expect(
      screen.queryByRole('button', { name: 'Pause subscription' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Still want to cancel?')).not.toBeInTheDocument();
    expect(
      screen.getByText('Why are you cancelling? (optional)')
    ).toBeInTheDocument();
  });

  it('shows the legacy retention line in the pause card for a legacy sub', () => {
    renderFlow({
      pauseEligible: true,
      isLegacyRate: true,
      planLabel: '$2 / month',
    });

    expect(
      screen.getByText(/Pausing keeps your legacy \$2 \/ month rate/)
    ).toBeInTheDocument();
  });
});
