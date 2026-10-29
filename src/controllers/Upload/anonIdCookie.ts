import type { Request } from 'express';

export function anonIdCookie(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.anon_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
