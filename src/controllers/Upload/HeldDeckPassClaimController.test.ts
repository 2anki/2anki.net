import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Request, Response } from 'express';
import type { Knex } from 'knex';
import type StripeTypes from 'stripe';

vi.mock('../../services/events/track', () => ({ track: vi.fn() }));

import { HeldDeckPassClaimController } from './HeldDeckPassClaimController';
import { ClaimHeldDeckWithPassUseCase } from '../../usecases/uploads/ClaimHeldDeckWithPassUseCase';
import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import { ValidateAnonymousPassUseCase } from '../../usecases/checkout/ValidateAnonymousPassUseCase';
import { configureUserLocal } from '../../routes/middleware/configureUserLocal';
import type AuthenticationService from '../../services/AuthenticationService';
import type { CheckoutPreviewBinding } from '../../usecases/uploads/ResumeAnonymousAiPreviewUseCase';
import { track } from '../../services/events/track';
import { EmptyDeckError } from '../../usecases/jobs/EmptyDeckError';

const trackMock = track as Mock;
const BUYER = 'anon-buyer-1';

interface MockResponse {
  locals: Record<string, unknown>;
  statusCode: number;
  body: unknown;
  status: Mock;
  json: Mock;
  send: Mock;
  set: Mock;
  attachment: Mock;
}

function mockRes(): MockResponse {
  const res: MockResponse = {
    locals: { requestId: 'req-1' },
    statusCode: 200,
    body: undefined,
    status: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
    set: vi.fn(),
    attachment: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((b: unknown) => {
    res.body = b;
    return res;
  });
  res.send.mockImplementation((b: unknown) => {
    res.body = b;
    return res;
  });
  res.set.mockReturnValue(res);
  res.attachment.mockReturnValue(res);
  return res;
}

function mockReq(
  anonId: string | null,
  passToken: string | null,
  body: unknown = {}
): Request {
  return {
    cookies: anonId == null ? {} : { anon_id: anonId },
    headers: passToken == null ? {} : { 'x-pass-token': passToken },
    body,
  } as unknown as Request;
}

const signedOut = {
  getUserFrom: vi.fn().mockResolvedValue(null),
} as unknown as AuthenticationService;

function stripeReturning(session: Record<string, unknown> | null) {
  return {
    checkout: {
      sessions: {
        retrieve: vi.fn().mockImplementation(async () => {
          if (session == null) throw new Error('no such session');
          return session;
        }),
      },
    },
  };
}

async function setup(
  options: {
    stripeSession?: Record<string, unknown> | null;
    binding?: CheckoutPreviewBinding;
  } = {}
) {
  const holds = new InMemoryHeldDeckRepository();
  const passes = new InMemoryAnonymousPassRepository();
  const convertHeldFileForPass = vi.fn().mockResolvedValue({
    apkg: Buffer.from('APKG BYTES'),
    cardCount: 150,
    deckName: 'notes',
  });
  const readBinding = vi
    .fn()
    .mockResolvedValue(
      options.binding ?? { anonId: BUYER, surface: 'anonymous-gate' }
    );
  const useCase = new ClaimHeldDeckWithPassUseCase(
    holds,
    {
      getFileContents: vi
        .fn()
        .mockResolvedValue({ Body: Buffer.from('<html></html>') }),
    },
    { convertHeldFileForPass },
    passes,
    readBinding
  );
  const validator = new ValidateAnonymousPassUseCase(
    passes,
    stripeReturning(options.stripeSession ?? null) as unknown as Pick<
      StripeTypes,
      'checkout'
    >
  );
  const controller = new HeldDeckPassClaimController(useCase);
  const hold = await holds.insert({
    storageKey: 'held/abc',
    anonId: BUYER,
    filename: 'notes.html',
    cardCount: 21,
    cardsHeldBack: 129,
    expiresAt: new Date(Date.now() + 60_000),
  });

  async function request(req: Request): Promise<MockResponse> {
    const res = mockRes();
    await configureUserLocal(
      req,
      res as unknown as Response,
      signedOut,
      {} as Knex,
      passes,
      new Date(),
      validator
    );
    await controller.claim(req, res as unknown as Response);
    return res;
  }

  return { holds, passes, hold, convertHeldFileForPass, request };
}

describe('HeldDeckPassClaimController through the pass middleware', () => {
  beforeEach(() => trackMock.mockClear());

  it('sends the full held deck to the visitor who bought the pass and marks it claimed', async () => {
    const { passes, holds, hold, convertHeldFileForPass, request } =
      await setup();
    const pass = await passes.insert({
      stripeSessionId: 'cs_paid',
      kind: '24h',
      expiresAt: new Date(Date.now() + 60_000),
      paymentIntentId: 'pi_paid',
    });

    const res = await request(
      mockReq(BUYER, 'cs_paid', { 'basic-reversed': 'true', bogus: 42 })
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(Buffer.from('APKG BYTES'));
    expect(res.set).toHaveBeenCalledWith('X-Card-Count', '150');
    expect(res.set).toHaveBeenCalledWith('File-Name', 'notes');
    expect(convertHeldFileForPass).toHaveBeenCalledWith(
      pass.id,
      expect.objectContaining({ originalname: 'notes.html' }),
      { 'basic-reversed': 'true' },
      'req-1'
    );
    expect(
      holds.rows.find((row) => row.id === hold.id)?.claimed_at
    ).toBeInstanceOf(Date);
    expect(trackMock).toHaveBeenCalledWith('anonymous_pass_held_claimed', {
      anonymousId: BUYER,
      anonymousPassId: pass.id,
      props: { card_count: 150, pass_kind: '24h' },
    });
  });

  it('reconciles a pass the webhook has not written yet straight from Stripe', async () => {
    const { convertHeldFileForPass, request } = await setup({
      stripeSession: {
        payment_status: 'paid',
        payment_intent: 'pi_fresh',
        created: Math.floor(Date.now() / 1000),
        metadata: {
          pass_kind: '24h',
          pass_anonymous: '1',
          anon_id: BUYER,
        },
      },
    });

    const res = await request(mockReq(BUYER, 'cs_fresh'));

    expect(res.statusCode).toBe(200);
    expect(convertHeldFileForPass).toHaveBeenCalledTimes(1);
  });

  it('refuses an unpaid checkout session and releases nothing', async () => {
    const { holds, hold, convertHeldFileForPass, request } = await setup({
      stripeSession: {
        payment_status: 'unpaid',
        payment_intent: 'pi_unpaid',
        created: Math.floor(Date.now() / 1000),
        metadata: { pass_kind: '24h', pass_anonymous: '1', anon_id: BUYER },
      },
    });

    const res = await request(mockReq(BUYER, 'cs_unpaid'));

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ code: 'pass_required' });
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
    expect(holds.rows.find((row) => row.id === hold.id)?.claimed_at).toBeNull();
  });

  it('refuses an expired pass and releases nothing', async () => {
    const { passes, holds, hold, convertHeldFileForPass, request } =
      await setup();
    await passes.insert({
      stripeSessionId: 'cs_expired',
      kind: '24h',
      expiresAt: new Date(Date.now() - 60_000),
      paymentIntentId: 'pi_expired',
    });

    const res = await request(mockReq(BUYER, 'cs_expired'));

    expect(res.statusCode).toBe(403);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
    expect(holds.rows.find((row) => row.id === hold.id)?.claimed_at).toBeNull();
  });

  it('refuses a request with no pass token', async () => {
    const { convertHeldFileForPass, request } = await setup();

    const res = await request(mockReq(BUYER, null));

    expect(res.statusCode).toBe(403);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
  });

  it('gives a reused pass session nothing the second time', async () => {
    const { passes, convertHeldFileForPass, request } = await setup();
    await passes.insert({
      stripeSessionId: 'cs_reuse',
      kind: '7d',
      expiresAt: new Date(Date.now() + 60_000),
      paymentIntentId: 'pi_reuse',
    });

    const first = await request(mockReq(BUYER, 'cs_reuse'));
    const second = await request(mockReq(BUYER, 'cs_reuse'));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(410);
    expect(second.body).toEqual({ code: 'held_deck_expired' });
    expect(convertHeldFileForPass).toHaveBeenCalledTimes(1);
  });

  it("does not release another visitor's deck to a pass bought under a different anon id", async () => {
    const { passes, holds, hold, convertHeldFileForPass, request } =
      await setup({
        binding: { anonId: 'anon-attacker', surface: 'anonymous-gate' },
      });
    await passes.insert({
      stripeSessionId: 'cs_attacker',
      kind: '24h',
      expiresAt: new Date(Date.now() + 60_000),
      paymentIntentId: 'pi_attacker',
    });

    const res = await request(mockReq(BUYER, 'cs_attacker'));

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ code: 'no_held_deck' });
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
    expect(holds.rows.find((row) => row.id === hold.id)?.claimed_at).toBeNull();
  });

  it.each([
    ['an array', ['basic-reversed']],
    ['a string', 'basic-reversed=true'],
    ['null', null],
  ])(
    'builds with default card options when the body is %s',
    async (_label, body) => {
      const { passes, convertHeldFileForPass, request } = await setup();
      await passes.insert({
        stripeSessionId: 'cs_oddbody',
        kind: '24h',
        expiresAt: new Date(Date.now() + 60_000),
        paymentIntentId: 'pi_oddbody',
      });

      const res = await request(mockReq(BUYER, 'cs_oddbody', body));

      expect(res.statusCode).toBe(200);
      expect(convertHeldFileForPass.mock.calls[0][2]).toEqual({});
    }
  );

  it('answers 404 for a pass holder with no anon id cookie', async () => {
    const { passes, convertHeldFileForPass, request } = await setup();
    await passes.insert({
      stripeSessionId: 'cs_nocookie',
      kind: '24h',
      expiresAt: new Date(Date.now() + 60_000),
      paymentIntentId: 'pi_nocookie',
    });

    const res = await request(mockReq(null, 'cs_nocookie'));

    expect(res.statusCode).toBe(404);
    expect(convertHeldFileForPass).not.toHaveBeenCalled();
  });

  it('answers 400 empty_export when the rebuilt deck has no cards', async () => {
    const { passes, convertHeldFileForPass, request } = await setup();
    await passes.insert({
      stripeSessionId: 'cs_empty',
      kind: '24h',
      expiresAt: new Date(Date.now() + 60_000),
      paymentIntentId: 'pi_empty',
    });
    convertHeldFileForPass.mockRejectedValueOnce(new EmptyDeckError());

    const res = await request(mockReq(BUYER, 'cs_empty'));

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: 'empty_export' });
  });
});
