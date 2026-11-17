import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelFlow } from './CancelFlow';

const PERIOD_END_SECONDS = Date.parse('2030-01-01T00:30:00.000Z') / 1000;

const renderFlow = (
  overrides: Partial<Parameters<typeof CancelFlow>[0]> = {}
) => {
  const props: Parameters<typeof CancelFlow>[0] = {
    isCancelling: false,
    access: { kind: 'untilPeriodEnd', periodEnd: PERIOD_END_SECONDS },
    onCancel: vi.fn(),
    onKeep: vi.fn(),
    ...overrides,
  };
  render(<CancelFlow {...props} />);
  return props;
};

let originalZone: string | undefined;

beforeEach(() => {
  originalZone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
});

afterEach(() => {
  process.env.TZ = originalZone;
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
  });

  it('labels the flow for assistive tech in the reader language', () => {
    renderFlow();

    expect(
      screen.getByRole('group', { name: 'Cancel subscription' })
    ).toBeInTheDocument();
  });

  it('offers keep as the primary action, ahead of a danger-styled cancel', () => {
    renderFlow();

    const keep = screen.getByRole('button', { name: 'Keep subscription' });
    const cancel = screen.getByRole('button', { name: 'Cancel subscription' });
    expect(keep).toHaveClass(/btnPrimary/);
    expect(cancel).toHaveClass(/btnDanger/);
    expect(cancel).not.toHaveClass(/btnPrimary/);
    expect(keep.compareDocumentPosition(cancel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});

describe('CancelFlow says when access ends before the confirm', () => {
  it('names the period end with its local date and time, ahead of the buttons', () => {
    renderFlow();

    const notice = screen.getByText(
      "You keep access until January 1, 2030 at 1:30 AM, the end of the period you paid for. Your card won't be charged again."
    );
    const keep = screen.getByRole('button', { name: 'Keep subscription' });
    expect(notice.compareDocumentPosition(keep)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('describes the cancel button with the notice, so it is read on focus', () => {
    renderFlow();

    expect(
      screen.getByRole('button', { name: 'Cancel subscription' })
    ).toHaveAccessibleDescription(
      "You keep access until January 1, 2030 at 1:30 AM, the end of the period you paid for. Your card won't be charged again."
    );
  });

  it('says it without a date when the subscription has no period end', () => {
    renderFlow({ access: { kind: 'untilPeriodEnd', periodEnd: null } });

    expect(
      screen.getByText(
        "You keep access until the end of the period you paid for. Your card won't be charged again."
      )
    ).toBeInTheDocument();
  });

  it('promises no access when the plan ends on cancel', () => {
    renderFlow({ access: { kind: 'notPromised' } });

    expect(screen.queryByText(/You keep access/)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Cancel subscription' })
    ).not.toHaveAccessibleDescription(/access/);
  });
});
