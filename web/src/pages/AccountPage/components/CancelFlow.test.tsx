import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { CancelFlow } from './CancelFlow';

const renderFlow = (
  overrides: Partial<Parameters<typeof CancelFlow>[0]> = {}
) => {
  const props = {
    planLabel: 'Monthly',
    tenureDays: 10,
    pauseEligible: false,
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
