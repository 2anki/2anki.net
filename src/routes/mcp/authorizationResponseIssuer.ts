import express from 'express';

const AUTHORIZATION_RESPONSE_PARAMS = ['code', 'error'];

function isAuthorizationResponse(url: URL): boolean {
  return AUTHORIZATION_RESPONSE_PARAMS.some((name) =>
    url.searchParams.has(name)
  );
}

function withIssuer(target: string, issuer: string): string {
  if (!URL.canParse(target)) {
    return target;
  }
  const url = new URL(target);
  if (!isAuthorizationResponse(url)) {
    return target;
  }
  url.searchParams.set('iss', issuer);
  return url.toString();
}

// RFC 9207: every authorization response back to the client's redirect_uri,
// success or error, names the issuer so a client sharing one redirect URI
// across servers (ChatGPT's connector redirect) can tell them apart. The SDK
// handler builds the error redirects itself, so this wraps res.redirect for
// the authorize route instead of patching each place a redirect is built.
// The login redirect is relative and carries neither code nor error, so it
// passes through unchanged.
export function authorizationResponseIssuer(
  issuer: string
): express.RequestHandler {
  return (_req, res, next) => {
    const redirect = res.redirect.bind(res) as (
      ...args: [string] | [number, string]
    ) => void;
    res.redirect = ((statusOrUrl: number | string, maybeUrl?: string) => {
      if (typeof statusOrUrl === 'number' && maybeUrl != null) {
        redirect(statusOrUrl, withIssuer(maybeUrl, issuer));
        return;
      }
      redirect(withIssuer(String(statusOrUrl), issuer));
    }) as express.Response['redirect'];
    next();
  };
}
