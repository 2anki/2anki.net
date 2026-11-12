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
    isCancelling: false,
    onCancel: vi.fn(),
    onKeep: vi.fn(),
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

describe('CancelFlow opening step', () => {
  it('opens on the reason question with no reason selected and no pause offer', () => {
    renderFlow();

    expect(
      screen.getByText('Why are you cancelling? (optional)')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Too expensive' })
    ).not.toBeChecked();
    expect(screen.queryByText(/Pause/)).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  it('labels the flow for assistive tech in the reader language', () => {
    renderFlow();

    expect(
      screen.getByRole('group', { name: 'Cancel subscription' })
    ).toBeInTheDocument();
  });

  it('offers cancel and keep side by side', () => {
    renderFlow();

    expect(
      screen.getByRole('button', { name: 'Cancel subscription' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Keep subscription' })
    ).toBeInTheDocument();
  });
});
