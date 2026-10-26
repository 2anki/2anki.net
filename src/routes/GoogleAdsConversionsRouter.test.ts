import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

const mockListClickConversions = vi.fn();

vi.mock('../data_layer', () => ({ getDatabase: vi.fn() }));

vi.mock('../data_layer/GoogleAdsConversionsRepository', () => ({
  GoogleAdsConversionsRepository: vi.fn().mockImplementation(function () {
    return { listClickConversions: mockListClickConversions };
  }),
}));

import GoogleAdsConversionsRouter from './GoogleAdsConversionsRouter';

async function buildServer() {
  const app = express();
  app.use(GoogleAdsConversionsRouter());
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

const PATH = '/api/google-ads/offline-conversions.csv';

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

const ORIGINAL_USER = process.env.GOOGLE_ADS_OFFLINE_CSV_USER;
const ORIGINAL_PASSWORD = process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD;

describe('GoogleAdsConversionsRouter', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    vi.clearAllMocks();
    mockListClickConversions.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = ORIGINAL_USER;
    process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD = ORIGINAL_PASSWORD;
  });

  it('returns 404 and reads no data when credentials are not configured', async () => {
    delete process.env.GOOGLE_ADS_OFFLINE_CSV_USER;
    delete process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD;

    const res = await fetch(`${url}${PATH}`, {
      headers: { authorization: basic('u', 'p') },
    });

    expect(res.status).toBe(404);
    expect(mockListClickConversions).not.toHaveBeenCalled();
  });

  it('returns 401 without credentials when the endpoint is configured', async () => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = 'u';
    process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD = 'p';

    const res = await fetch(`${url}${PATH}`);

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic realm=');
    expect(mockListClickConversions).not.toHaveBeenCalled();
  });

  it('serves the conversions CSV for a request with valid credentials', async () => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = 'u';
    process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD = 'p';
    mockListClickConversions.mockResolvedValue([
      {
        gclid: 'Cj0abc',
        gbraid: null,
        wbraid: null,
        orderId: 'cs_1',
        valueCents: 600,
        currency: 'usd',
        conversionTime: new Date('2026-10-20T10:00:00.000Z'),
      },
    ]);

    const res = await fetch(`${url}${PATH}`, {
      headers: { authorization: basic('u', 'p') },
    });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(body.split('\n')[0]).toBe('Parameters:TimeZone=+0000');
    expect(body).toContain('Cj0abc,,,Purchase (server)');
    expect(body).toContain('6.00,USD,cs_1');
  });
});
