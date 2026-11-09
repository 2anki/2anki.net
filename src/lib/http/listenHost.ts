// Express trusts one proxy hop for the client IP, which holds only if every
// request really comes through Apache. Listening on all interfaces let anyone
// reach the app port directly and set that header themselves, so an IP-based
// rate limit could be sidestepped.
export function listenHost(nodeEnv = process.env.NODE_ENV): string | undefined {
  return nodeEnv === 'production' ? '127.0.0.1' : undefined;
}
