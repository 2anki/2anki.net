import { Request, Response, NextFunction } from 'express';

// Duplicate /convert/<slug> paths that should 301 to their bare canonical
// twin, plus removed pages and a stray literal that should 301 to the page
// that replaced them. The destinations are hard-coded constants looked up by
// exact path, so no request data reaches the redirect target. Each target is
// the trailing-slash URL the prerendered page is served at, so a visitor lands
// in one hop instead of bouncing through the static directory redirect. The
// query string is intentionally dropped: these are canonicalization redirects
// for duplicate URLs, and search engines key on the path.
const CONVERT_REDIRECTS = new Map<string, string>([
  ['/convert/notion-to-anki', '/notion-to-anki/'],
  ['/convert/notion-to-anki/', '/notion-to-anki/'],
  ['/convert/pdf-to-anki', '/pdf-to-anki/'],
  ['/convert/pdf-to-anki/', '/pdf-to-anki/'],
  ['/convert/markdown-to-anki', '/markdown-to-anki/'],
  ['/convert/markdown-to-anki/', '/markdown-to-anki/'],
  ['/convert/enrich-anki-deck', '/convert/'],
  ['/convert/enrich-anki-deck/', '/convert/'],
  ['/transform', '/upload/'],
  ['/transform/', '/upload/'],
  ['/:splat', '/'],
]);

export function redirectConvertDuplicates(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const target = CONVERT_REDIRECTS.get(req.path);
  if (target != null) {
    res.redirect(301, target);
    return;
  }
  next();
}
