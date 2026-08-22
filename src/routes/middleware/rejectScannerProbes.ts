import { Request, Response, NextFunction } from 'express';

const PROBE_EXTENSIONS =
  /\.(php|env|asp|aspx|jsp|cgi|bak|old|save|sql|htaccess|htpasswd)$/i;

const CMS_SCANNER_PREFIXES =
  /^\/(wp-|wordpress|phpmyadmin|cgi-bin|vendor\/phpunit)/i;

const HIDDEN_FIRST_SEGMENT = /^\/\.(?!well-known(\/|$))/;

function isScannerProbe(path: string): boolean {
  return (
    PROBE_EXTENSIONS.test(path) ||
    CMS_SCANNER_PREFIXES.test(path) ||
    HIDDEN_FIRST_SEGMENT.test(path)
  );
}

export default function rejectScannerProbes(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (isScannerProbe(req.path)) {
    res.status(404).end();
    return;
  }
  next();
}
