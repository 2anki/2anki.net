import { vi, type Mock } from 'vitest';

vi.mock('../data_layer', () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock('../services/events/track', () => ({ track: vi.fn() }));

import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import aiGiftRouter from './AiGiftRouter';
import { InMemoryAiCreditGiftsRepository } from '../data_layer/AiCreditGiftsRepository';
import {
  AI_GIFT_FEEDBACK_EVENT,
  cachedExposure,
  type AiGiftDeps,
} from '../usecases/ai/aiGift/aiGiftDeps';
import { track } from '../services/events/track';

const trackMock = track as Mock;
const OPENING = new Date('2026-11-25T12:00:00.000Z');

interface Harness {
  url: string;
  gifts: InMemoryAiCreditGiftsRepository;
  setNow: (date: Date) => void;
  setEnabled: (enabled: boolean) => void;
  close: () => Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const gifts = new InMemoryAiCreditGiftsRepository();
  let now = OPENING;
  let enabled = true;
  const exposure = cachedExposure(
    (at) => gifts.exposureCredits(at),
    () => 0
  );
  const deps: AiGiftDeps = {
    gifts,
    isEnabled: async () => enabled,
    exposureCredits: (at) => gifts.exposureCredits(at),
    forgetExposure: exposure.forget,
    feedbackCount: async (userId) =>
      trackMock.mock.calls.filter(
        ([name, options]) =>
          name === AI_GIFT_FEEDBACK_EVENT && options?.userId === userId
      ).length,
    now: () => now,
  };
  const signedIn: express.RequestHandler = (req, res, next) => {
    const user = req.header('x-test-user');
    if (user != null) {
      res.locals.owner = Number(user);
    }
    next();
  };
  const requireAuth: express.RequestHandler = (req, res, next) => {
    const user = req.header('x-test-user');
    if (user == null) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    res.locals.owner = Number(user);
    next();
  };
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(aiGiftRouter({ deps, optionalAuth: signedIn, requireAuth }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    gifts,
    setNow: (date) => {
      now = date;
    },
    setEnabled: (value) => {
      enabled = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function headers(user: number | null, ip = '203.0.113.7') {
  return {
    'content-type': 'application/json',
    'x-forwarded-for': ip,
    ...(user == null ? {} : { 'x-test-user': String(user) }),
  };
}

async function getGift(h: Harness, user: number | null) {
  const res = await fetch(`${h.url}/api/ai/gift`, { headers: headers(user) });
  return { status: res.status, body: await res.json() };
}

async function claim(h: Harness, user: number | null, ip?: string) {
  const res = await fetch(`${h.url}/api/ai/gift/claim`, {
    method: 'POST',
    headers: headers(user, ip),
    body: '{}',
  });
  return { status: res.status, body: await res.json() };
}

async function answer(h: Harness, user: number, payload: unknown) {
  const res = await fetch(`${h.url}/api/ai/gift/feedback`, {
    method: 'POST',
    headers: headers(user),
    body: JSON.stringify(payload),
  });
  return res.status;
}

function eventsNamed(name: string) {
  return trackMock.mock.calls.filter(([event]) => event === name);
}

let h: Harness;

beforeAll(() => {
  process.env.THE_HASHING_SECRET = 'test-hashing-secret';
});

beforeEach(async () => {
  trackMock.mockClear();
  h = await startHarness();
});

afterEach(async () => {
  await h.close();
});

describe('the gift switched off', () => {
  beforeEach(() => h.setEnabled(false));

  it('is closed for a signed-out visitor and a signed-in account', async () => {
    expect((await getGift(h, null)).body).toEqual({
      state: 'closed',
      feedbackDue: false,
    });
    expect((await getGift(h, 5)).body).toEqual({
      state: 'closed',
      feedbackDue: false,
    });
  });

  it('refuses a claim and stores nothing', async () => {
    const res = await claim(h, 5);

    expect(res).toEqual({ status: 410, body: { code: 'gift_closed' } });
    expect(h.gifts.gifts).toEqual([]);
  });
});

describe('GET /api/ai/gift while the gift is open', () => {
  it('offers the gift to a signed-out visitor', async () => {
    const res = await getGift(h, null);

    expect(res).toEqual({
      status: 200,
      body: {
        state: 'open',
        credits: 100,
        hours: 48,
        claimClosesAt: '2026-12-04T20:00:00.000Z',
        feedbackDue: false,
      },
    });
  });

  it('closes for everyone without a gift once claims close', async () => {
    h.setNow(new Date('2026-12-04T20:00:00.000Z'));

    expect((await getGift(h, null)).body.state).toBe('closed');
    expect((await getGift(h, 8)).body.state).toBe('closed');
  });
});

describe('POST /api/ai/gift/claim', () => {
  it('needs an account', async () => {
    const res = await claim(h, null);

    expect(res.status).toBe(401);
    expect(h.gifts.gifts).toEqual([]);
  });

  it('grants 100 credits for 48 hours and shows them as claimed', async () => {
    const res = await claim(h, 5);

    expect(res).toEqual({
      status: 200,
      body: { credits: 100, expiresAt: '2026-11-27T12:00:00.000Z' },
    });
    expect((await getGift(h, 5)).body).toEqual({
      state: 'claimed',
      credits: 100,
      expiresAt: '2026-11-27T12:00:00.000Z',
      feedbackDue: false,
    });
    expect(eventsNamed('ai_gift_claimed')).toEqual([
      [
        'ai_gift_claimed',
        expect.objectContaining({
          userId: 5,
          props: expect.objectContaining({ credits: 100, gift_id: 1 }),
        }),
      ],
    ]);
  });

  it('stores a keyed hash of the network, never the address', async () => {
    await claim(h, 5, '198.51.100.23');

    const stored = h.gifts.gifts[0].ipHash;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain('198.51.100.23');
  });

  it('allows one claim per account, ever', async () => {
    await claim(h, 5);
    h.setNow(new Date('2026-11-30T12:00:00.000Z'));

    const second = await claim(h, 5, '198.51.100.99');

    expect(second).toEqual({
      status: 409,
      body: { code: 'gift_already_claimed' },
    });
    expect(h.gifts.gifts).toHaveLength(1);
    expect(eventsNamed('ai_gift_claim_refused')).toEqual([
      [
        'ai_gift_claim_refused',
        expect.objectContaining({
          userId: 5,
          props: expect.objectContaining({ reason: 'gift_already_claimed' }),
        }),
      ],
    ]);
  });

  it('never lets credits outlive 2026-12-04 22:00 UTC', async () => {
    h.setNow(new Date('2026-12-04T19:00:00.000Z'));

    const res = await claim(h, 5);

    expect(res.body.expiresAt).toBe('2026-12-04T22:00:00.000Z');
  });

  it('refuses every claim from 2026-12-04 20:00 UTC', async () => {
    h.setNow(new Date('2026-12-04T20:00:00.000Z'));

    expect(await claim(h, 5)).toEqual({
      status: 410,
      body: { code: 'gift_closed' },
    });
  });

  it('caps a network at three claims a day', async () => {
    const ip = '192.0.2.44';
    for (const user of [1, 2, 3]) {
      expect((await claim(h, user, ip)).status).toBe(200);
    }

    expect(await claim(h, 4, ip)).toEqual({
      status: 429,
      body: { code: 'gift_ip_limit' },
    });
    expect((await claim(h, 4, '192.0.2.45')).status).toBe(200);

    h.setNow(new Date(OPENING.getTime() + 24 * 60 * 60 * 1000 + 1));
    expect((await claim(h, 6, ip)).status).toBe(200);
  });

  it('counts an IPv6 /64 as one network', async () => {
    for (const [user, suffix] of [
      [1, '1'],
      [2, '2'],
      [3, '3'],
    ] as const) {
      await claim(h, user, `2001:db8:aa:bb::${suffix}`);
    }

    expect((await claim(h, 4, '2001:db8:aa:bb::ffff')).status).toBe(429);
  });
});

describe('the gift budget', () => {
  it('never grants past 11000 credits, even when claims arrive together', async () => {
    const claims = Array.from({ length: 130 }, (_, i) =>
      claim(h, 1000 + i, `10.0.${Math.floor(i / 200)}.${i % 200}`)
    );

    const results = await Promise.all(claims);

    expect(results.filter((r) => r.status === 200)).toHaveLength(110);
    expect(
      results
        .filter((r) => r.status !== 200)
        .every((r) => r.body.code === 'gift_budget_full')
    ).toBe(true);
    expect(await h.gifts.exposureCredits(OPENING)).toBe(11000);
  });

  it('shows the gifts as all claimed for now once the budget is full', async () => {
    for (let i = 0; i < 110; i += 1) {
      await claim(h, 2000 + i, `10.1.${Math.floor(i / 3)}.1`);
    }

    expect((await getGift(h, null)).body).toEqual({
      state: 'full',
      feedbackDue: false,
    });
  });

  it('frees the unspent credits of expired gifts, but keeps what they spent', async () => {
    for (let i = 0; i < 110; i += 1) {
      await claim(h, 3000 + i, `10.2.${Math.floor(i / 3)}.1`);
    }
    h.gifts.spend.push({
      giftId: 1,
      userId: 3000,
      costUsd: 0.6,
      at: OPENING,
    });

    h.setNow(new Date('2026-11-27T12:00:00.000Z'));

    expect((await claim(h, 4000, '10.9.9.9')).status).toBe(200);
    expect(
      await h.gifts.exposureCredits(new Date('2026-11-27T12:00:00.000Z'))
    ).toBeCloseTo(160, 5);
  });

  it('counts a gift that in-flight calls took past 100 at what it cost', async () => {
    for (let i = 0; i < 109; i += 1) {
      await claim(h, 5000 + i, `10.3.${Math.floor(i / 3)}.1`);
    }
    h.gifts.spend.push({
      giftId: 1,
      userId: 5000,
      costUsd: 1.3,
      at: OPENING,
    });

    expect(await claim(h, 6000, '10.8.8.8')).toEqual({
      status: 409,
      body: { code: 'gift_budget_full' },
    });
  });
});

describe('the one question after a gift-funded conversion', () => {
  beforeEach(async () => {
    await claim(h, 5);
  });

  it('is not due before the gift paid for anything', async () => {
    expect((await getGift(h, 5)).body.feedbackDue).toBe(false);
  });

  it('is due once gift credits paid for a conversion, and the balance shows the spend', async () => {
    h.gifts.spend.push({ giftId: 1, userId: 5, costUsd: 0.37, at: OPENING });

    expect((await getGift(h, 5)).body).toEqual({
      state: 'claimed',
      credits: 63,
      expiresAt: '2026-11-27T12:00:00.000Z',
      feedbackDue: true,
    });
  });

  it('records the answer once and stops asking', async () => {
    h.gifts.spend.push({ giftId: 1, userId: 5, costUsd: 0.37, at: OPENING });

    expect(await answer(h, 5, { answer: 'yes' })).toBe(204);
    expect(await answer(h, 5, { answer: 'no', comment: 'again' })).toBe(409);
    expect((await getGift(h, 5)).body.feedbackDue).toBe(false);
    expect(eventsNamed(AI_GIFT_FEEDBACK_EVENT)).toEqual([
      [
        AI_GIFT_FEEDBACK_EVENT,
        expect.objectContaining({
          userId: 5,
          props: expect.objectContaining({ answer: 'yes', gift_id: 1 }),
        }),
      ],
    ]);
  });

  it('strips markup from a no comment and cuts it to 500 characters', async () => {
    const comment = `<script>alert(1)</script><b>too</b> ${'x'.repeat(600)}`;

    expect(await answer(h, 5, { answer: 'no', comment })).toBe(204);

    const [[, options]] = eventsNamed(AI_GIFT_FEEDBACK_EVENT);
    const stored = options.props.comment as string;
    expect(stored.startsWith('too x')).toBe(true);
    expect(stored).not.toContain('<');
    expect(stored).not.toContain('alert');
    expect(Array.from(stored).length).toBeLessThanOrEqual(500);
  });

  it('keeps a long comment within what the events sink accepts', async () => {
    const comment = '"\\'.repeat(400);

    await answer(h, 5, { answer: 'no', comment });

    const [[, options]] = eventsNamed(AI_GIFT_FEEDBACK_EVENT);
    expect(JSON.stringify(options.props).length).toBeLessThanOrEqual(1024);
  });

  it('drops a comment sent with a yes', async () => {
    await answer(h, 5, { answer: 'yes', comment: 'hello' });

    const [[, options]] = eventsNamed(AI_GIFT_FEEDBACK_EVENT);
    expect(Object.keys(options.props)).not.toContain('comment');
  });

  it('refuses an answer outside yes, no and dismissed', async () => {
    expect(await answer(h, 5, { answer: 'maybe' })).toBe(400);
  });

  it('refuses an account that never claimed the gift', async () => {
    expect(await answer(h, 77, { answer: 'yes' })).toBe(403);
  });
});
