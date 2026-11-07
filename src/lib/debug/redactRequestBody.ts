// A match by name, not a fixed list, so a new secret field is hidden by default.
// Hiding a harmless field from a debug copy costs nothing.
const SECRET_FIELD = /credential|pass|token|secret|auth|key/i;

const REDACTED = '[redacted]';

// Debug copies of a request go to an inbox and to disk, and a request can carry
// a PDF password, an account password or a Google Drive access token.
export function redactRequestBody(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body.map(redactRequestBody);
  }
  if (body == null || typeof body !== 'object') {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      SECRET_FIELD.test(key) ? REDACTED : redactRequestBody(value),
    ])
  );
}
