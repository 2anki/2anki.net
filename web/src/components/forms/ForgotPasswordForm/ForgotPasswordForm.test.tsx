import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordForm from './ForgotPasswordForm';
import { UserNotice } from '../../../lib/errors/UserNotice';

const mockRequestMagicLink = vi.fn();

vi.mock('../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ requestMagicLink: mockRequestMagicLink }),
}));

function submit(email: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
}

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    localStorage.clear();
    mockRequestMagicLink.mockReset();
  });

  it('asks the person to check their email once the link is sent', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, status: 200 });
    const setError = vi.fn();
    render(<ForgotPasswordForm setError={setError} />);

    submit('reader@example.com');

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(setError).not.toHaveBeenCalled();
  });

  it('reports that the link could not be sent when the send fails', async () => {
    mockRequestMagicLink.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ code: 'unknown' }),
    });
    const setError = vi.fn();
    render(<ForgotPasswordForm setError={setError} />);

    submit('reader@example.com');

    await waitFor(() => expect(setError).toHaveBeenCalledTimes(1));
    expect(mockRequestMagicLink).toHaveBeenCalledWith(
      'reader@example.com',
      'password_reset'
    );
    const [notice] = setError.mock.calls[0];
    expect(notice).toBeInstanceOf(UserNotice);
    expect(notice.message).toBe(
      "Couldn't send the link just now. Try again in a moment."
    );
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument();
  });

  it('asks for a full address beside the field and sends nothing for a domain without a dot', async () => {
    const setError = vi.fn();
    render(<ForgotPasswordForm setError={setError} />);

    submit('reader@gmail');

    expect(
      await screen.findByText(
        'Enter a full email address, like name@example.com.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    expect(mockRequestMagicLink).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it('shows the server refusal of an address beside the field', async () => {
    mockRequestMagicLink.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ code: 'invalid_email' }),
    });
    const setError = vi.fn();
    render(<ForgotPasswordForm setError={setError} />);

    submit('reader@example.com');

    expect(
      await screen.findByText(
        'Enter a full email address, like name@example.com.'
      )
    ).toBeInTheDocument();
    expect(setError).not.toHaveBeenCalled();
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument();
  });
});
