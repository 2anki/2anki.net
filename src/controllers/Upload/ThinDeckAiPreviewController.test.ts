import { vi } from 'vitest';
import type { Request, Response } from 'express';
import { AiPreviewRateLimiter } from '../../lib/upload/aiPreviewRateLimiter';
import {
  THIN_DECK_MAX_IN_FLIGHT,
  THIN_DECK_MAX_IN_FLIGHT_PER_IP,
  THIN_DECK_SLOT_DEADLINE_MS,
  ThinDeckAiPreviewController,
} from './ThinDeckAiPreviewController';

vi.mock('../../lib/featureFlags/getFeatureFlag', () => ({
  getFeatureFlag: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../services/events/track', () => ({ track: vi.fn() }));
vi.mock('../../lib/claude/aiPreview', () => ({
  generateAiPreview: vi.fn(),
}));
vi.mock('../../lib/upload/extractPreviewText', async (importActual) => ({
  ...(await importActual<
    typeof import('../../lib/upload/extractPreviewText')
  >()),
  extractPreviewText: vi.fn().mockResolvedValue('some study text'),
}));

import { extractPreviewText } from '../../lib/upload/extractPreviewText';
import { getFeatureFlag } from '../../lib/featureFlags/getFeatureFlag';
import { generateAiPreview } from '../../lib/claude/aiPreview';
import { track } from '../../services/events/track';

const CARDS = [{ front: 'Q', back: 'A' }];

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    body: { consent: 'claude' },
    file: { originalname: 'notes.pdf', buffer: Buffer.from('x') },
    cookies: { anon_id: 'visitor-1' },
    headers: {},
    socket: { remoteAddress: '203.0.113.5' },
    ...overrides,
  } as unknown as Request;
}

function makeRes(locals: Record<string, unknown> = {}) {
  const res = {
    locals,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    once: vi.fn(),
    headersSent: false,
  };
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe('ThinDeckAiPreviewController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFeatureFlag).mockResolvedValue(true);
    vi.mocked(generateAiPreview).mockResolvedValue(CARDS);
  });

  it('returns the sample cards for a visitor who tapped the button', async () => {
    const res = makeRes();

    await new ThinDeckAiPreviewController().preview(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ kind: 'preview', cards: CARDS });
  });

  it('never calls Claude without the consent field', async () => {
    const res = makeRes();

    await new ThinDeckAiPreviewController().preview(makeReq({ body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ code: 'consent_required' });
    expect(generateAiPreview).not.toHaveBeenCalled();
  });

  it('refuses a request with no file', async () => {
    const res = makeRes();

    await new ThinDeckAiPreviewController().preview(
      makeReq({ file: undefined }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(generateAiPreview).not.toHaveBeenCalled();
  });

  it('refuses a request that is neither signed in nor carries a visitor id', async () => {
    const res = makeRes();

    await new ThinDeckAiPreviewController().preview(
      makeReq({ cookies: {} }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(generateAiPreview).not.toHaveBeenCalled();
  });

  it('answers 404 when the flag is off', async () => {
    vi.mocked(getFeatureFlag).mockResolvedValue(false);
    const res = makeRes();

    await new ThinDeckAiPreviewController().preview(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(generateAiPreview).not.toHaveBeenCalled();
  });

  it('records the preview against the signed in user', async () => {
    const res = makeRes({ owner: 7 });

    await new ThinDeckAiPreviewController().preview(
      makeReq({ cookies: {} }),
      res
    );

    expect(track).toHaveBeenCalledWith('thin_deck_ai_preview_shown', {
      userId: 7,
      anonymousId: null,
      props: { card_count: 1 },
    });
  });

  it('stops answering with cards once the visitor is over the limit', async () => {
    const controller = new ThinDeckAiPreviewController(
      new AiPreviewRateLimiter()
    );
    let last = makeRes();
    for (let i = 0; i < 4; i++) {
      last = makeRes();
      await controller.preview(makeReq(), last);
    }

    expect(last.json).toHaveBeenLastCalledWith({ kind: 'unavailable' });
    expect(generateAiPreview).toHaveBeenCalledTimes(3);
  });

  it.each([['true'], [['claude', 'claude']], [undefined]])(
    'rejects consent sent as %j',
    async (consent) => {
      const res = makeRes();

      await new ThinDeckAiPreviewController().preview(
        makeReq({ body: { consent } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(generateAiPreview).not.toHaveBeenCalled();
    }
  );

  it('still stops a visitor who rotates the anon id from the same address', async () => {
    const controller = new ThinDeckAiPreviewController(
      new AiPreviewRateLimiter()
    );
    for (let i = 0; i < 25; i++) {
      await controller.preview(
        makeReq({ cookies: { anon_id: `rotated-${i}` } }),
        makeRes()
      );
    }

    expect(generateAiPreview).toHaveBeenCalledTimes(20);
  });

  it('cuts a text upload before it is decoded', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024, 'a');

    await new ThinDeckAiPreviewController().preview(
      makeReq({ file: { originalname: 'notes.txt', buffer: big } }),
      makeRes()
    );

    const passed = vi.mocked(extractPreviewText).mock.calls[0][1];
    expect(passed.length).toBe(1024 * 1024);
  });
});

describe('ThinDeckAiPreviewController.guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFeatureFlag).mockResolvedValue(true);
  });

  it('answers 404 before any file is read when the flag is off', async () => {
    vi.mocked(getFeatureFlag).mockResolvedValue(false);
    const res = makeRes();
    const next = vi.fn();

    await new ThinDeckAiPreviewController().guard(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses new uploads while the in-flight cap is full and frees a slot on finish', async () => {
    const controller = new ThinDeckAiPreviewController();
    const finishers: Array<() => void> = [];
    const resWithFinish = () => {
      const res = makeRes();
      (res as unknown as { once: unknown }).once = (
        event: string,
        cb: () => void
      ) => {
        if (event === 'finish') finishers.push(cb);
      };
      return res;
    };
    const next = vi.fn();
    const fromIp = (n: number) =>
      makeReq({ socket: { remoteAddress: `203.0.113.${n}` } });
    for (let i = 0; i < THIN_DECK_MAX_IN_FLIGHT; i++) {
      await controller.guard(fromIp(i + 1), resWithFinish(), next);
    }
    const refused = makeRes();

    await controller.guard(fromIp(99), refused, next);

    expect(refused.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(THIN_DECK_MAX_IN_FLIGHT);

    finishers[0]();
    await controller.guard(fromIp(99), resWithFinish(), next);

    expect(next).toHaveBeenCalledTimes(THIN_DECK_MAX_IN_FLIGHT + 1);
  });

  it('stops one address holding every slot', async () => {
    const controller = new ThinDeckAiPreviewController();
    const next = vi.fn();
    for (let i = 0; i < THIN_DECK_MAX_IN_FLIGHT_PER_IP; i++) {
      await controller.guard(makeReq(), makeRes(), next);
    }
    const refused = makeRes();

    await controller.guard(makeReq(), refused, next);

    expect(refused.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(THIN_DECK_MAX_IN_FLIGHT_PER_IP);
  });

  it('frees a stalled slot after the deadline and answers 408', async () => {
    vi.useFakeTimers();
    try {
      const controller = new ThinDeckAiPreviewController();
      const next = vi.fn();
      const stalled = makeRes();
      for (let i = 0; i < THIN_DECK_MAX_IN_FLIGHT_PER_IP; i++) {
        await controller.guard(makeReq(), i === 0 ? stalled : makeRes(), next);
      }

      vi.advanceTimersByTime(THIN_DECK_SLOT_DEADLINE_MS);

      expect(stalled.status).toHaveBeenCalledWith(408);
      await controller.guard(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(THIN_DECK_MAX_IN_FLIGHT_PER_IP + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases a slot once when both finish and close fire', async () => {
    const controller = new ThinDeckAiPreviewController();
    const handlers: Array<() => void> = [];
    const res = makeRes();
    (res as unknown as { once: unknown }).once = (_e: string, cb: () => void) =>
      handlers.push(cb);
    const next = vi.fn();
    await controller.guard(makeReq(), res, next);
    await controller.guard(makeReq(), makeRes(), next);

    handlers.forEach((cb) => cb());
    const admitted = makeRes();
    await controller.guard(makeReq(), admitted, next);
    const refused = makeRes();
    await controller.guard(makeReq(), refused, next);

    expect(admitted.status).not.toHaveBeenCalled();
    expect(refused.status).toHaveBeenCalledWith(429);
  });
});
