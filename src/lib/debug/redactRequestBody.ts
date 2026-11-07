const SECRET_FIELDS: ReadonlySet<string> = new Set(['credential', 'password']);

const REDACTED = '[redacted]';

// Debug copies of a request go to an inbox and to disk, and a request can carry
// a PDF password or an account password.
export function redactRequestBody(body: unknown): unknown {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      SECRET_FIELDS.has(key) ? REDACTED : value,
    ])
  );
}
