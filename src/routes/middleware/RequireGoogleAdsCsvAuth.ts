import type { NextFunction, Request, Response } from 'express';

import { timingSafeStringEqual } from '../../lib/misc/timingSafeStringEqual';

const REALM = 'Google Ads offline conversions';

interface Credentials {
  user: string;
  password: string;
}

function configuredCredentials(): Credentials | null {
  const user = process.env.GOOGLE_ADS_OFFLINE_CSV_USER;
  const password = process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD;
  if (user == null || user === '' || password == null || password === '') {
    return null;
  }
  return { user, password };
}

function decodeBasicAuth(header: string | undefined): Credentials | null {
  if (header == null) {
    return null;
  }
  const [scheme, encoded] = header.split(' ');
  if (scheme == null || scheme.toLowerCase() !== 'basic' || encoded == null) {
    return null;
  }
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return null;
  }
  return {
    user: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

function challenge(res: Response): void {
  res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
  res.status(401).end();
}

// Fail closed: with no credentials configured the endpoint does not exist, so
// an unconfigured deployment never serves conversion data.
export function requireGoogleAdsCsvAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const configured = configuredCredentials();
  if (configured == null) {
    res.status(404).end();
    return;
  }
  const provided = decodeBasicAuth(req.headers.authorization);
  if (provided == null) {
    challenge(res);
    return;
  }
  const userOk = timingSafeStringEqual(provided.user, configured.user);
  const passwordOk = timingSafeStringEqual(
    provided.password,
    configured.password
  );
  if (userOk && passwordOk) {
    next();
    return;
  }
  challenge(res);
}

export default requireGoogleAdsCsvAuth;
