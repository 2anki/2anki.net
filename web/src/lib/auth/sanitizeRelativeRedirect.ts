const SAFE_RELATIVE_REDIRECT = /^\/(?![/\\])[^\s\\]+$/;

export const sanitizeRelativeRedirect = (
  value: string | null | undefined
): string | undefined => {
  if (value == null) {
    return undefined;
  }
  return SAFE_RELATIVE_REDIRECT.test(value) ? value : undefined;
};
