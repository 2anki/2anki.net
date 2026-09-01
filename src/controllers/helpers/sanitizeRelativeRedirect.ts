const SAFE_RELATIVE_REDIRECT = /^\/(?![/\\])[^\s\\]+$/;

export const sanitizeRelativeRedirect = (
  value: unknown
): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  return SAFE_RELATIVE_REDIRECT.test(value) ? value : undefined;
};
