import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { noindexAuthPages } from './noindexAuthPages';

interface AddressWithPort {
  port: number;
}

const serverSource = fs.readFileSync(
  path.join(__dirname, '../../server.ts'),
  'utf8'
);

async function robotsTagFor(
  app: express.Express,
  url: string
): Promise<string | null> {
  const server = http.createServer(app).listen(0);
  try {
    const port = (server.address() as AddressWithPort).port;
    const res = await fetch(`http://127.0.0.1:${port}${url}`);
    return res.headers.get('x-robots-tag');
  } finally {
    server.close();
  }
}

function shellApp(): express.Express {
  const app = express();
  app.use(noindexAuthPages);
  app.get(/.*/, (_req, res) => res.send('<html>spa</html>'));
  return app;
}

describe('noindexAuthPages wire-up', () => {
  it('is mounted once in server.ts', () => {
    expect(serverSource.match(/app\.use\(noindexAuthPages\)/g)).toHaveLength(1);
  });

  it.each([
    'mountWebBuild(app',
    'app.use(usersRouter())',
    'app.use(defaultRouter())',
  ])('is mounted in server.ts before %s, which answers the page', (later) => {
    const mount = serverSource.indexOf('app.use(noindexAuthPages)');
    const responder = serverSource.indexOf(later);
    expect(responder).toBeGreaterThan(-1);
    expect(mount).toBeLessThan(responder);
  });

  it.each([
    '/register?source=x',
    '/login?redirect=/upload',
    '/login?redirect=%2Fmcp%2Fauthorize%3Fclient_id%3Dabc',
    '/users/r/3f9c1a7e-5b2d-4c1e-9a7f-0d2e4b6c8a1f',
  ])('labels the shell served for %s noindex', async (url) => {
    expect(await robotsTagFor(shellApp(), url)).toBe('noindex');
  });

  it('labels nothing when it is mounted after the page answers (regression guard)', async () => {
    const app = express();
    app.get(/.*/, (_req, res) => res.send('<html>spa</html>'));
    app.use(noindexAuthPages);
    expect(await robotsTagFor(app, '/register?source=x')).toBeNull();
  });
});
