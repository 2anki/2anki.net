import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import TopMessage from './TopMessage';

const queryParams = new Map<string, string>();

vi.mock('../../lib/hooks/useQuery', () => ({
  default: () => ({
    get: (key: string) => queryParams.get(key) ?? null,
  }),
}));

function renderWithError(error: string | null) {
  queryParams.clear();
  if (error != null) {
    queryParams.set('error', error);
  }
  return render(
    <MemoryRouter>
      <TopMessage />
    </MemoryRouter>
  );
}

describe('TopMessage', () => {
  it('maps google_signin_failed to mapped copy', () => {
    renderWithError('google_signin_failed');
    expect(
      screen.getByText(
        "Couldn't sign you in with Google. Try again, or use your email below."
      )
    ).toBeInTheDocument();
  });

  it('maps notion_cancelled to mapped copy', () => {
    renderWithError('notion_cancelled');
    expect(
      screen.getByText(
        "Couldn't sign you in with Notion. Try again, or use your email below."
      )
    ).toBeInTheDocument();
  });

  it.each([
    [
      'google_signin_expired',
      'That Google sign-in timed out or was already used. Try again below.',
    ],
    [
      'microsoft_signin_expired',
      'That Microsoft sign-in timed out or was already used. Try again below.',
    ],
    [
      'notion_signin_expired',
      'That Notion sign-in timed out or was already used. Try again below.',
    ],
  ])('tells a visitor back from %s to sign in again', (error, copy) => {
    renderWithError(error);
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it.each(['toString', 'constructor', '__proto__'])(
    'shows the generic message for the inherited property name %s',
    (error) => {
      renderWithError(error);
      expect(
        screen.getByText(
          "Couldn't sign you in. Try again, or use your email below."
        )
      ).toBeInTheDocument();
    }
  );

  it('shows a generic message for an unknown error code instead of echoing it', () => {
    renderWithError('<script>alert(1)</script>');
    expect(
      screen.getByText(
        "Couldn't sign you in. Try again, or use your email below."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('<script>alert(1)</script>')
    ).not.toBeInTheDocument();
  });

  it('renders nothing when there is no error or verified param', () => {
    const { container } = renderWithError(null);
    expect(container).toBeEmptyDOMElement();
  });
});
