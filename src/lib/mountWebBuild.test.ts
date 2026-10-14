import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { mountWebBuild } from './mountWebBuild';

describe('mountWebBuild', () => {
  let buildDir: string;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-build-'));
    fs.writeFileSync(path.join(buildDir, 'index.html'), '<html>app</html>');
    fs.mkdirSync(path.join(buildDir, 'assets'));
    fs.writeFileSync(path.join(buildDir, 'assets', 'app-abc123.css'), 'body{}');

    const app = express();
    mountWebBuild(app, buildDir);
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (address == null || typeof address === 'string') {
          reject(new Error('expected an ephemeral port'));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        fs.rmSync(buildDir, { recursive: true, force: true });
        resolve();
      });
    });
  });

  it('leaves / to the router so the shell gets its consent region stamp', async () => {
    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(404);
  });

  it('leaves a direct /index.html request to the router as well', async () => {
    const response = await fetch(`${baseUrl}/index.html`);

    expect(response.status).toBe(404);
  });

  it('still serves plain files from the build directory', async () => {
    fs.writeFileSync(path.join(buildDir, 'robots.txt'), 'User-agent: *');
    const response = await fetch(`${baseUrl}/robots.txt`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('User-agent: *');
  });

  it('keeps hashed assets immutable for a year', async () => {
    const response = await fetch(`${baseUrl}/assets/app-abc123.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    );
  });
});
