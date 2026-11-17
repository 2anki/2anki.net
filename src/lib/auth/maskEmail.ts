const HIDDEN = '•••';

export function maskEmail(email: string): string {
  const address = email.trim();
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) {
    return HIDDEN;
  }
  const domain = address.slice(at);
  const local = Array.from(address.slice(0, at));
  if (local.length === 1) {
    return `•${domain}`;
  }
  return `${local[0]}${HIDDEN}${domain}`;
}
