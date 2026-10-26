/**
 * The server marks `<html data-auth="1">` when the page request carried a
 * session cookie. Until user locals load, it says which page the visitor is
 * about to see, so that page can be laid out from first paint instead of
 * shifting once locals arrive. Layout only: never decide access with it.
 */
export function hasSessionHint(): boolean {
  return globalThis.document?.documentElement?.dataset.auth === '1';
}
