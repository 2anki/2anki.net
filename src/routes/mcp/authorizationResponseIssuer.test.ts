import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { authorizationResponseIssuer } from './authorizationResponseIssuer';

const ISSUER = 'https://2anki.net/';

async function redirectFrom(
  handler: express.RequestHandler
): Promise<string | null> {
  const app = express();
  app.use('/authorize', authorizationResponseIssuer(ISSUER), handler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/authorize`, {
      redirect: 'manual',
    });
    return res.headers.get('location');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('authorizationResponseIssuer', () => {
  it('adds iss to a success redirect with a status code', async () => {
    const location = await redirectFrom((_req, res) => {
      res.redirect(302, 'https://client.example/cb?code=abc&state=s1');
    });

    const url = new URL(location ?? '');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
    expect(url.searchParams.get('code')).toBe('abc');
    expect(url.searchParams.get('state')).toBe('s1');
  });

  it('adds iss to an error redirect without a status code', async () => {
    const location = await redirectFrom((_req, res) => {
      res.redirect('https://client.example/cb?error=access_denied&state=s1');
    });

    const url = new URL(location ?? '');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
    expect(url.searchParams.get('error')).toBe('access_denied');
  });

  it('leaves the relative login redirect unchanged', async () => {
    const location = await redirectFrom((_req, res) => {
      res.redirect('/login?next=%2Fmcp%2Fauthorize%3Fcode%3Dx');
    });

    expect(location).toBe('/login?next=%2Fmcp%2Fauthorize%3Fcode%3Dx');
  });

  it('leaves an absolute redirect with neither code nor error unchanged', async () => {
    const location = await redirectFrom((_req, res) => {
      res.redirect('https://2anki.net/login?next=x');
    });

    expect(location).toBe('https://2anki.net/login?next=x');
  });
});
