const HIDDEN = '•••';

export function maskEmail(email: string): string {
  const address = email.trim();
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) {
    return HIDDEN;
  }
  return `${address[0]}${HIDDEN}${address.slice(at)}`;
}
