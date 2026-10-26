import { vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { mountWebBuild } from '../lib/mountWebBuild';

const { buildDir } = vi.hoisted(() => {
  const nodeFs = require('node:fs') as typeof import('node:fs');
  const nodeOs = require('node:os') as typeof import('node:os');
  const nodePath = require('node:path') as typeof import('node:path');
  return {
    buildDir: nodeFs.mkdtempSync(
      nodePath.join(nodeOs.tmpdir(), 'docs-serving-')
    ),
  };
});

vi.mock('../controllers/IndexController/getIndexFileContents', () => ({
  getIndexFileContents: () => '<html><head></head><body>shell</body></html>',
}));

vi.mock(
  '../controllers/IndexController/getPrerenderedPage',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../controllers/IndexController/getPrerenderedPage')
      >();
    return {
      getPrerenderedPage: (requestPath: string) =>
        actual.getPrerenderedPage(requestPath, buildDir),
    };
  }
);

const writePage = (dir: string, body: string) => {
  fs.mkdirSync(path.join(buildDir, dir), { recursive: true });
  fs.writeFileSync(path.join(buildDir, dir, 'index.html'), body);
};

describe('serving prerendered docs pages', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    writePage('documentation', '<html><body>docs home</body></html>');
    writePage(
      'documentation/start-here/connect-notion',
      '<html><body>connect notion</body></html>'
    );
    const { default: DefaultRouter } = await import('./DefaultRouter');
    const app = express();
    mountWebBuild(app, buildDir);
    app.use(DefaultRouter());
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    fs.rmSync(buildDir, { recursive: true, force: true });
  });

  it.each([
    ['/documentation/start-here/connect-notion/', 'connect notion'],
    ['/documentation/', 'docs home'],
  ])('serves %s from its prerendered file', async (docPath, text) => {
    const res = await fetch(`${url}${docPath}`);
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain(text);
  });

  it.each(['/documentation/start-here/connect-notion', '/documentation'])(
    'sends %s to its trailing-slash URL',
    async (docPath) => {
      const res = await fetch(`${url}${docPath}`, { redirect: 'manual' });
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe(`${docPath}/`);
    }
  );

  it.each(['/documentation/not-a-page', '/documentation/not-a-page/'])(
    'answers the unknown docs path %s with a 404',
    async (docPath) => {
      const res = await fetch(`${url}${docPath}`, { redirect: 'manual' });
      expect(res.status).toBe(404);
    }
  );

  it('still serves a legacy docs slug so the client can redirect it', async () => {
    const res = await fetch(`${url}/documentation/guides/getting-started`);
    expect(res.status).toBe(200);
  });
});
