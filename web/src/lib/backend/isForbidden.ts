import { FORBIDDEN } from './http';

export const isForbidden = (error: unknown): boolean =>
  (error as { status?: number } | undefined)?.status === FORBIDDEN;
