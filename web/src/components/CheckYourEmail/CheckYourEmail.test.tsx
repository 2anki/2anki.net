import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import CheckYourEmail from './CheckYourEmail';

describe('CheckYourEmail', () => {
  it('renders login purpose copy', () => {
    render(
      <CheckYourEmail
        email="user@example.com"
        onRetry={vi.fn()}
        purpose="login"
      />
    );
    expect(screen.getByText('Check your email')).toBeInTheDocument();
    expect(screen.getByText(/login link/)).toBeInTheDocument();
    expect(screen.getByText(/log in/)).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('renders password_reset purpose copy', () => {
    render(
      <CheckYourEmail
        email="user@example.com"
        onRetry={vi.fn()}
        purpose="password_reset"
      />
    );
    expect(screen.getByText(/password reset link/)).toBeInTheDocument();
    expect(screen.getByText(/reset your password/)).toBeInTheDocument();
  });

  it('shows Gmail link for gmail.com addresses', () => {
    render(
      <CheckYourEmail
        email="user@gmail.com"
        onRetry={vi.fn()}
        purpose="login"
      />
    );
    const gmailLink = screen.getByRole('link', { name: 'Open Gmail' });
    expect(gmailLink).toHaveAttribute('href', 'https://mail.google.com');
    expect(gmailLink).toHaveAttribute('target', '_blank');
  });

  it('shows Outlook link for hotmail.com addresses', () => {
    render(
      <CheckYourEmail
        email="user@hotmail.com"
        onRetry={vi.fn()}
        purpose="login"
      />
    );
    expect(screen.getByRole('link', { name: 'Open Outlook' })).toHaveAttribute(
      'href',
      'https://outlook.live.com'
    );
  });

  it('shows Yahoo link for yahoo.com addresses', () => {
    render(
      <CheckYourEmail
        email="user@yahoo.com"
        onRetry={vi.fn()}
        purpose="login"
      />
    );
    expect(
      screen.getByRole('link', { name: 'Open Yahoo Mail' })
    ).toHaveAttribute('href', 'https://mail.yahoo.com');
  });

  it('shows no provider links for unknown domains', () => {
    render(
      <CheckYourEmail
        email="user@company.com"
        onRetry={vi.fn()}
        purpose="login"
      />
    );
    expect(screen.queryByRole('link', { name: /Open/ })).toBeNull();
  });

  it('calls onRetry when the try again link is clicked', () => {
    const onRetry = vi.fn();
    render(
      <CheckYourEmail
        email="user@example.com"
        onRetry={onRetry}
        purpose="login"
      />
    );
    fireEvent.click(screen.getByText('try again'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows delivery estimate text', () => {
    render(
      <CheckYourEmail
        email="user@example.com"
        onRetry={vi.fn()}
        purpose="login"
      />
    );
    expect(
      screen.getByText(/Usually arrives within a minute/)
    ).toBeInTheDocument();
  });

  it('shows a resend link button', () => {
    render(
      <CheckYourEmail
        email="user@example.com"
        onRetry={vi.fn()}
        purpose="login"
        onResend={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Resend link' })
    ).toBeInTheDocument();
  });

  it('shows Sent after resend succeeds', async () => {
    const onResend = vi.fn().mockResolvedValue(undefined);
    render(
      <CheckYourEmail
        email="user@example.com"
        onRetry={vi.fn()}
        purpose="login"
        onResend={onResend}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resend link' }));
    await waitFor(() => {
      expect(screen.getByText('Sent')).toBeInTheDocument();
    });
  });

  it('shows support link at the bottom', () => {
    render(
      <CheckYourEmail
        email="user@example.com"
        onRetry={vi.fn()}
        purpose="login"
      />
    );
    const link = screen.getByRole('link', { name: 'support@2anki.net' });
    expect(link).toHaveAttribute('href', 'mailto:support@2anki.net');
  });

  it('shows resend error copy with spam and support hint when resend fails', async () => {
    const onResend = vi.fn().mockRejectedValue(new Error('rate limited'));
    render(
      <CheckYourEmail
        email="user@example.com"
        onRetry={vi.fn()}
        purpose="password_reset"
        onResend={onResend}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resend link' }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Couldn't send another link right now. Check your inbox and spam, or email support@2anki.net."
        )
      ).toBeInTheDocument();
    });
  });

  it('shows nuanced still-nothing copy at the bottom', () => {
    render(
      <CheckYourEmail
        email="user@example.com"
        onRetry={vi.fn()}
        purpose="login"
      />
    );
    expect(
      screen.getByText(/Still nothing after checking spam\?/)
    ).toBeInTheDocument();
    expect(screen.getByText(/we'll get you in/)).toBeInTheDocument();
  });
});
