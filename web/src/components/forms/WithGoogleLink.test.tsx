import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { WithGoogleLink } from './WithGoogleLink';

describe('WithGoogleLink', () => {
  it('starts the sign-in on the server, which binds the OAuth state to this browser', () => {
    render(<WithGoogleLink text="Sign in with Google" />);
    const link = screen.getByRole('link', { name: /Sign in with Google/i });
    expect(link).toHaveAttribute('href', '/api/users/auth/google/init');
  });

  it('displays the provided text in row variant', () => {
    render(<WithGoogleLink text="Sign up with Google" />);
    expect(screen.getByText('Sign up with Google')).toBeInTheDocument();
  });

  it('card variant shows the short "Google" label and keeps the full text as accessible name', () => {
    render(<WithGoogleLink text="Sign in with Google" variant="card" />);
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Sign in with Google' })
    ).toBeInTheDocument();
  });
});
