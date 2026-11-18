import { sanitizeRelativeRedirect } from './sanitizeRelativeRedirect';

export function withSignInReturn(
  initUrl: string,
  redirect: string | null | undefined
): string {
  const safe = sanitizeRelativeRedirect(redirect);
  if (safe == null) {
    return initUrl;
  }
  return `${initUrl}?redirect=${encodeURIComponent(safe)}`;
}
