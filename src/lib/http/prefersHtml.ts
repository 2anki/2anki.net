import type { Request } from 'express';

export const prefersHtml = (req: Request): boolean => {
  if (req.method !== 'GET') {
    return false;
  }
  const accept = req.headers.accept ?? '';
  return accept.includes('text/html');
};
