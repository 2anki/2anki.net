import { Request, Response } from 'express';
import { EventsController } from './EventsController';
import { TrackEventUseCase } from '../usecases/events/TrackEventUseCase';
import { EventsSink } from '../services/events/EventsSink';
import { IEventsRepository } from '../data_layer/EventsRepository';
import * as path from 'path';
import * as fs from 'fs';

function makeFakeRepository(): IEventsRepository {
  return {
    insertEvents: jest.fn(async () => undefined),
    countByName: jest.fn(async () => 0),
    countDistinctUsers: jest.fn(async () => 0),
    countByNameForUser: jest.fn(async () => 0),
    lastEventAt: jest.fn(async () => null),
    groupPaywallShownByVariantAndSurface: jest.fn(async () => []),
    groupPaywallClicksByVariant: jest.fn(async () => []),
    groupUploadFunnel: jest.fn(async () => []),
    groupUploadFunnelByOrigin: jest.fn(async () => []),
    groupConversionFailedByReason: jest.fn(async () => ({
      paywall: 0,
      empty: 0,
      technical: 0,
    })),
  };
}

function buildMocks(opts: {
  userId?: number | null;
  anonId?: string | null;
  firstTouch?: string;
}) {
  const repo = makeFakeRepository();
  const sink = new EventsSink(repo);
  const useCase = new TrackEventUseCase(sink);
  const executeSpy = jest.spyOn(useCase, 'execute');
  const controller = new EventsController(useCase);

  const cookies: Record<string, string> = {};
  if (opts.anonId != null) cookies.anon_id = opts.anonId;
  if (opts.firstTouch != null) cookies.first_touch = opts.firstTouch;

  const req = {
    body: {},
    cookies,
  } as unknown as Request;

  const res = {
    locals: { owner: opts.userId ?? undefined },
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  } as unknown as Response;

  return { controller, req, res, executeSpy };
}

describe('EventsController', () => {
  it('returns 400 when name is missing', () => {
    const { controller, req, res } = buildMocks({});
    req.body = {};
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when the body is unparseable (Express 5 leaves it undefined)', () => {
    const { controller, req, res } = buildMocks({});
    (req as { body?: unknown }).body = undefined;
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when name is not a string', () => {
    const { controller, req, res } = buildMocks({});
    req.body = { name: 42 };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when name exceeds 64 characters', () => {
    const { controller, req, res } = buildMocks({});
    req.body = { name: 'a'.repeat(65) };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when props is an array', () => {
    const { controller, req, res } = buildMocks({});
    req.body = { name: 'deck_downloaded', props: [1, 2, 3] };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when props exceed 1KB', () => {
    const { controller, req, res } = buildMocks({});
    req.body = {
      name: 'deck_downloaded',
      props: { data: 'x'.repeat(1025) },
    };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 202 with a valid known event', () => {
    const { controller, req, res } = buildMocks({
      userId: 5,
      anonId: 'anon-x',
    });
    req.body = { name: 'deck_downloaded' };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('returns 202 for paywall_dismissed (AC #1)', () => {
    const { controller, req, res } = buildMocks({ userId: 1 });
    req.body = { name: 'paywall_dismissed' };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('returns 202 for pricing_left (AC #2)', () => {
    const { controller, req, res } = buildMocks({ userId: 1 });
    req.body = { name: 'pricing_left' };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('returns 202 for upload_failed (AC #3)', () => {
    const { controller, req, res } = buildMocks({ userId: 1 });
    req.body = { name: 'upload_failed' };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('records unknown event name tagged with unknown:true and does not 400 (AC #4)', () => {
    const { controller, req, res, executeSpy } = buildMocks({ userId: 1 });
    req.body = { name: 'not_a_real_event_xyzzy' };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ unknown: true })
    );
  });

  it('known events are NOT tagged unknown', () => {
    const { controller, req, res, executeSpy } = buildMocks({ userId: 1 });
    req.body = { name: 'deck_downloaded' };
    controller.track(req, res);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ unknown: false })
    );
  });

  it('attaches signup_origin from the first_touch cookie so anon events segment by origin', () => {
    const { controller, req, res, executeSpy } = buildMocks({
      anonId: 'anon-x',
      firstTouch: JSON.stringify({ landingPath: '/nclex' }),
    });
    req.body = { name: 'upload_started' };
    controller.track(req, res);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ props: { signup_origin: '/nclex' } })
    );
  });

  it('does not override a client-supplied signup_origin', () => {
    const { controller, req, res, executeSpy } = buildMocks({
      firstTouch: JSON.stringify({ landingPath: '/nclex' }),
    });
    req.body = { name: 'upload_started', props: { signup_origin: '/mcat' } };
    controller.track(req, res);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ props: { signup_origin: '/mcat' } })
    );
  });

  it('leaves props untouched when there is no first_touch cookie', () => {
    const { controller, req, res, executeSpy } = buildMocks({ anonId: 'a' });
    req.body = { name: 'upload_started' };
    controller.track(req, res);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ props: {} })
    );
  });

  it('reads userId from res.locals.owner and never from request body', () => {
    const { controller, req, res, executeSpy } = buildMocks({
      userId: 99,
      anonId: 'anon-y',
    });
    req.body = { name: 'conversion_succeeded', props: { user_id: 1 } };
    controller.track(req, res);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 99 })
    );
  });

  it('reads anonymousId from cookie', () => {
    const { controller, req, res, executeSpy } = buildMocks({
      anonId: 'cookie-anon',
    });
    req.body = { name: 'upload_error_chat_shown' };
    controller.track(req, res);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ anonymousId: 'cookie-anon' })
    );
  });

  it('passes null anonymousId when cookie is absent', () => {
    const { controller, req, res, executeSpy } = buildMocks({});
    req.body = { name: 'deck_downloaded' };
    controller.track(req, res);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ anonymousId: null })
    );
  });

  it.each([
    'photo_entry_point_viewed',
    'photo_entry_point_clicked',
    'photo_upload_started',
    'photo_quota_reached',
  ])('returns 202 for new photo event: %s', (eventName) => {
    const { controller, req, res } = buildMocks({ userId: 1 });
    req.body = { name: eventName };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it.each([
    'sidebar_auto_minimize_fired',
    'sidebar_auto_minimize_reverted',
    'card_size_selected',
  ])('returns 202 for sidebar/card-size event: %s', (eventName) => {
    const { controller, req, res } = buildMocks({ userId: 1 });
    req.body = { name: eventName };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it.each([
    'upload_ai_badge_viewed',
    'upload_ai_free_badge_clicked',
    'upload_ai_turned_on',
    'upload_ai_turned_off',
  ])('records client event %s as known, not unknown', (eventName) => {
    const { controller, req, res, executeSpy } = buildMocks({ userId: 1 });
    req.body = { name: eventName };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: eventName, unknown: false })
    );
  });

  it.each([
    'ankify_review_session_started',
    'ankify_review_completed',
    'ankify_review_session_exited',
  ])('accepts Ankify review event %s as known, not unknown', (eventName) => {
    const { controller, req, res, executeSpy } = buildMocks({ userId: 1 });
    req.body = { name: eventName };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: eventName, unknown: false })
    );
  });

  it.each([
    'native_app_page_viewed',
    'native_app_interest_clicked',
    'native_app_store_clicked',
  ])('accepts native-app event %s as known, not unknown', (eventName) => {
    const { controller, req, res, executeSpy } = buildMocks({ userId: 1 });
    req.body = { name: eventName };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: eventName, unknown: false })
    );
  });

  it.each([
    'image_only_photo_deck_shown',
    'image_only_photo_deck_clicked',
    'ankify_decklist_sorted',
    'empty_back_notice_shown',
  ])('accepts client event %s as known, not unknown', (eventName) => {
    const { controller, req, res, executeSpy } = buildMocks({ userId: 1 });
    req.body = { name: eventName };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: eventName, unknown: false })
    );
  });

  it('accepts columns_guessed_notice_shown as known, not unknown', () => {
    const { controller, req, res, executeSpy } = buildMocks({ userId: 1 });
    req.body = { name: 'columns_guessed_notice_shown' };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'columns_guessed_notice_shown',
        unknown: false,
      })
    );
  });

  it('accepts shared_deck_published as known, not unknown', () => {
    const { controller, req, res, executeSpy } = buildMocks({ userId: 1 });
    req.body = { name: 'shared_deck_published' };
    controller.track(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'shared_deck_published', unknown: false })
    );
  });
});

describe('EventsController — regression: all client events return 202 (AC #5)', () => {
  const clientEventsPath = path.resolve(
    __dirname,
    '../../web/src/lib/analytics/events.ts'
  );

  const clientEventsSource = fs.readFileSync(clientEventsPath, 'utf-8');
  const matches = clientEventsSource.matchAll(/'([a-z_]+)'/g);
  const clientEventNames = [...matches]
    .map((m) => m[1])
    .filter((n) => n !== 'as');

  it.each(clientEventNames)(
    'server returns 202 for client event: %s',
    (eventName) => {
      const { controller, req, res } = buildMocks({ userId: 1 });
      req.body = { name: eventName };
      controller.track(req, res);
      expect(res.status).toHaveBeenCalledWith(202);
    }
  );
});
