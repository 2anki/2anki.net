import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { Backend } from './Backend';
import { forgetLandingCampaign, rememberLandingCampaign } from '../adClick';

vi.mock('./api', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  getLoginURL: vi.fn(),
  redirectToLogin: vi.fn(),
}));

const ok = () =>
  ({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ url: 'https://stripe/s' }),
  }) as unknown as Response;

function sentBody(): Record<string, unknown> {
  return vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
}

describe('checkout requests carry the landing campaign tags', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset().mockResolvedValue(ok());
  });

  afterEach(() => {
    forgetLandingCampaign();
  });

  it.each([
    ['pass', (b: Backend) => b.startPassCheckout('24h', undefined, 'limit')],
    ['unlimited', (b: Backend) => b.startUnlimitedCheckout('month')],
    ['auto sync', (b: Backend) => b.startAutoSyncCheckout()],
    ['credit pack', (b: Backend) => b.startCreditPackCheckout('credits')],
  ])('sends them with a %s checkout', async (_label, start) => {
    rememberLandingCampaign(
      '?utm_source=google&utm_campaign=ai-search&gclid=Cj0abc'
    );

    await start(new Backend());

    expect(sentBody().campaign).toEqual({
      utm_source: 'google',
      utm_campaign: 'ai-search',
    });
  });

  it('sends no campaign when the visit did not land from a tagged link', async () => {
    rememberLandingCampaign('?foo=bar');

    await new Backend().startPassCheckout('24h');

    expect(sentBody().campaign).toBeUndefined();
  });
});
