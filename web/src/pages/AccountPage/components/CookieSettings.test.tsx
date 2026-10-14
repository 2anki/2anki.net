import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CookieSettings } from './CookieSettings';

beforeEach(() => {
  document.documentElement.dataset.consentRegion = 'eea';
});

afterEach(() => {
  document.cookie = 'cookie_consent=; Max-Age=0; Path=/';
  delete document.documentElement.dataset.consentRegion;
});

describe('CookieSettings', () => {
  it('shows the current choice and switches it', () => {
    render(<CookieSettings />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Only necessary cookies are set'
    );
    expect(
      screen.getByRole('button', { name: 'Only necessary' })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Allow all' }));

    expect(document.cookie).toContain('cookie_consent=granted');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Analytics and ads cookies are allowed'
    );
    expect(screen.getByRole('button', { name: 'Allow all' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('reflects the regional default outside the EEA', () => {
    document.documentElement.dataset.consentRegion = 'other';

    render(<CookieSettings />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Analytics and ads cookies are allowed'
    );
  });
});
