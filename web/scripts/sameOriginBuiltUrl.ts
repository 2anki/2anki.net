const SAME_ORIGIN_PREFIXES = ['fonts/'];

export function sameOriginBuiltUrl(filename: string): string | undefined {
  const normalized = filename.replace(/^\/+/, '');
  const prefix = SAME_ORIGIN_PREFIXES.find((p) => normalized.startsWith(p));
  return prefix == null ? undefined : `/${normalized}`;
}
