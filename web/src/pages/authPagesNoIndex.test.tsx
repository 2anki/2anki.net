import type { ReactElement, ReactNode } from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CookiesProvider } from 'react-cookie';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './LoginPage/LoginPage';
import { RegisterPage } from './RegisterPage/RegisterPage';
import { ForgotPasswordPage } from './ForgotPasswordPage/ForgotPasswordPage';
import MagicLinkPage from './MagicLinkPage/MagicLinkPage';
import AccountEmailChangePage from './AccountEmailChangePage/AccountEmailChangePage';

vi.mock('../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({ data: undefined, isLoading: false, isError: false }),
}));
vi.mock('./LoginPage/components/LoginForm', () => ({
  default: () => <div />,
}));
vi.mock('../components/forms/RegisterForm', () => ({
  default: () => <div />,
}));
vi.mock('../components/forms/ForgotPasswordForm/ForgotPasswordForm', () => ({
  default: () => <div />,
}));
vi.mock('../components/AuthPageBackground', () => ({
  AuthPageBackground: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    validateMagicToken: () => new Promise(() => {}),
    requestMagicLink: vi.fn(),
  }),
}));
vi.mock('../lib/backend/api', () => ({
  post: () => new Promise(() => {}),
}));

function renderAt(path: string, page: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CookiesProvider>
        <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
      </CookiesProvider>
    </QueryClientProvider>
  );
}

// These pages no longer inherit the homepage canonical from the shell, so
// each one tells crawlers to stay out on its own.
describe('auth pages are kept out of the index', () => {
  it.each<[string, ReactElement]>([
    ['/login', <LoginPage key="login" />],
    ['/register', <RegisterPage key="register" setErrorMessage={vi.fn()} />],
    ['/forgot', <ForgotPasswordPage key="forgot" setErrorMessage={vi.fn()} />],
    ['/auth/magic?token=abc', <MagicLinkPage key="magic" />],
    [
      '/account/email-change?token=abc',
      <AccountEmailChangePage key="email-change" />,
    ],
  ])('%s carries a noindex robots meta', async (path, page) => {
    renderAt(path, page);
    await waitFor(() => {
      expect(
        document.head.querySelector('meta[name="robots"]')
      ).toHaveAttribute('content', 'noindex');
    });
  });
});
