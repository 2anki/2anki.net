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
    mockRequestMagicLink.mockResolvedValue({ ok: false, status: 500 });
    const setError = vi.fn();
    render(<ForgotPasswordForm setError={setError} />);

    submit('reader@example.com');

    await waitFor(() => expect(setError).toHaveBeenCalledTimes(1));
    const [notice] = setError.mock.calls[0];
    expect(notice).toBeInstanceOf(UserNotice);
    expect(notice.message).toBe(
      "Couldn't send the link just now. Try again in a moment."
    );
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument();
  });
});
