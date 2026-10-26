import { Request, Response, NextFunction } from 'express';

import { legacyDocsRedirectTarget } from '../../lib/legacyDocsRedirects';

// Old documentation URLs 301 to the page that replaced them in one hop. The
// destination is a hard-coded constant looked up by exact path, so no request
// data reaches the redirect target. The query string is dropped, as in
// redirectConvertDuplicates: search engines key on the path.
export function redirectLegacyDocs(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const target = legacyDocsRedirectTarget(req.path);
  if (target != null) {
    res.redirect(301, target);
    return;
  }
  next();
}
