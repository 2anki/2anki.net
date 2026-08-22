import { Request, Response, NextFunction } from 'express';
import rejectScannerProbes from './rejectScannerProbes';

function mockReqRes(method: string, path: string) {
  const req = { method, path } as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    end: jest.fn(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('rejectScannerProbes', () => {
  it.each([
    '/phpinfo.php',
    '/mysql/.env',
    '/admin/test.asp',
    '/old/config.bak',
    '/.htaccess',
    '/dump.sql',
  ])('returns 404 for %s', (path) => {
    const { req, res, next } = mockReqRes('GET', path);
    rejectScannerProbes(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    '/.git/config',
    '/.docker/laravel/app/.env',
    '/.aws/credentials',
    '/.cache',
    '/.ssh/id_rsa',
  ])('returns 404 for the hidden-directory probe %s', (path) => {
    const { req, res, next } = mockReqRes('GET', path);
    rejectScannerProbes(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    '/wp-admin/',
    '/wp-content/plugins/x.txt',
    '/wp-includes/wlwmanifest.xml',
    '/wordpress/wp-login.js',
    '/phpmyadmin/index.html',
    '/cgi-bin/test',
    '/vendor/phpunit/whatever',
  ])('returns 404 for the CMS-scanner path %s', (path) => {
    const { req, res, next } = mockReqRes('GET', path);
    rejectScannerProbes(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects probe paths on POST too', () => {
    const { req, res, next } = mockReqRes('POST', '/xmlrpc.php');
    rejectScannerProbes(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    '/.well-known/security.txt',
    '/.well-known/apple-developer-domain-association.txt',
  ])('passes through the legitimate dot path %s', (path) => {
    const { req, res, next } = mockReqRes('GET', path);
    rejectScannerProbes(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    '/login',
    '/downloads',
    '/notion-to-anki',
    '/api/users/me',
    '/assets/app.js',
    '/index.html',
  ])('passes through for %s', (path) => {
    const { req, res, next } = mockReqRes('GET', path);
    rejectScannerProbes(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
