interface ResetTokenFields {
  reset_token_expires_at?: Date | string | null;
  reset_token_used_at?: Date | string | null;
}

// A stored reset token is only reusable while it is unused and still inside
// its window. Rows written before the expiry column existed have a null
// expiry and are never live, so they get replaced rather than re-sent.
export function isResetTokenLive(
  user: ResetTokenFields,
  now: Date = new Date()
): boolean {
  if (user.reset_token_used_at != null) {
    return false;
  }
  const expiresAt = user.reset_token_expires_at;
  if (expiresAt == null) {
    return false;
  }
  const expiry =
    expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt));
  if (Number.isNaN(expiry.getTime())) {
    return false;
  }
  return expiry.getTime() > now.getTime();
}
