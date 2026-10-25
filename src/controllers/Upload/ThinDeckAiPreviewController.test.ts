import { vi } from 'vitest';
import type { Request, Response } from 'express';
import { AiPreviewRateLimiter } from '../../lib/upload/aiPreviewRateLimiter';
import { ThinDeckAiPreviewController } from './ThinDeckAiPreviewController';

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
});
