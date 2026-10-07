import { vi, type Mock } from 'vitest';
import express from 'express';
import { APIErrorCode, APIResponseError } from '@notionhq/client';
import NotionController from './NotionController';
import NotionService from '../services/NotionService';
import {
  InProgressJobError,
  JobLimitError,
} from '../lib/storage/jobs/helpers/errors';
import { INotionRepository } from '../data_layer/NotionRespository';
import { IEmailService } from '../services/EmailService/EmailService';
import UsersRepository from '../data_layer/UsersRepository';
import { buildNativeOAuthState } from '../services/NotionService/nativeOAuthState';
import {
  ConversionChildCrashedError,
  WORKER_INTERRUPTED_REASON,
} from '../lib/workerTermination';
import { CONVERSION_PROCESS_CRASHED_REASON } from '../usecases/jobs/jobFailureReason';

vi.mock('../lib/conversionPool', () => ({
  __esModule: true,
  runConversion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/events/track', () => ({
  __esModule: true,
  track: vi.fn(),
}));
vi.mock('../data_layer', () => ({
  getDatabase: vi.fn().mockReturnValue({}),
}));
vi.mock('../data_layer/JobRepository');
vi.mock('../usecases/jobs/FindOrCreateJobUseCase');
vi.mock('../usecases/jobs/ClaimJobForRestartUseCase');
vi.mock('../usecases/jobs/CheckJobLimitUseCase');
vi.mock('../usecases/jobs/CancelJobUseCase');

import { runConversion } from '../lib/conversionPool';
import { track } from '../services/events/track';
import JobRepository from '../data_layer/JobRepository';
import { FindOrCreateJobUseCase } from '../usecases/jobs/FindOrCreateJobUseCase';
import { ClaimJobForRestartUseCase } from '../usecases/jobs/ClaimJobForRestartUseCase';
import { CheckJobLimitUseCase } from '../usecases/jobs/CheckJobLimitUseCase';
import { CancelJobUseCase } from '../usecases/jobs/CancelJobUseCase';

function buildNotionRepo(
  overrides: Partial<INotionRepository> = {}
): INotionRepository {
  return {
    getNotionData: vi.fn(),
    saveNotionToken: vi.fn(),
    getNotionToken: vi.fn(),
    deleteBlocksByOwner: vi.fn(),
    deleteNotionData: vi.fn(),
    markTokenInvalid: vi.fn().mockResolvedValue(undefined),
    clearTokenInvalid: vi.fn(),
    setReconnectEmailSent: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildEmailService(): IEmailService {
  return {
    sendResetEmail: vi.fn(),
    sendConversionEmail: vi.fn(),
    sendConversionLinkEmail: vi.fn(),
    sendContactEmail: vi.fn(),
    sendSubscriptionCancelledEmail: vi.fn(),
    sendSubscriptionScheduledCancellationEmail: vi.fn(),
    sendSubscriptionResumingSoonEmail: vi.fn().mockResolvedValue(undefined),
    sendHostedAnkiAccessRequestEmail: vi.fn(),
    sendMagicLinkEmail: vi.fn(),
    sendReEngagementEmail: vi.fn(),
    sendInactivityWarningEmail: vi.fn(),
    sendAbandonedCheckoutRecoveryEmail: vi.fn(),
    sendPassWinbackEmail: vi.fn(),
    sendParserCanaryAlert: vi.fn(),
    sendAiSpendAlertEmail: vi.fn(),
    sendNotionReconnectEmail: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionClaimConfirmation: vi.fn().mockResolvedValue(undefined),
    sendPassClaimConfirmation: vi.fn().mockResolvedValue(undefined),
    sendAnonymousPassClaimEmail: vi.fn().mockResolvedValue(undefined),
    sendContactConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendPriceLockInEmail: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionRecoveryEmail: vi.fn().mockResolvedValue(undefined),
    sendEmailChangeConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendEmailChangeNotificationEmail: vi.fn().mockResolvedValue(undefined),
  };
}

function buildUsersRepo(): UsersRepository {
  return {
    getEmailById: vi.fn().mockResolvedValue(undefined),
  } as unknown as UsersRepository;
}

describe('NotionController', () => {
  let service: NotionService;
  let controller: NotionController;
  let req: Partial<express.Request>;
  let res: Partial<express.Response>;

  const pageId = '363e39e6-3d46-4414-9af9-0fccf8c8d913';

  const buildApi = (overrides: Record<string, unknown> = {}) =>
    ({
      listBlocksPage: vi.fn().mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false,
      }),
      getPage: vi.fn().mockResolvedValue(null),
      ...overrides,
    }) as any;

  function setupConvertMocks({
    created = true,
    claimed = true,
    withinLimit = true,
    jobStatus = 'started',
  }: {
    created?: boolean;
    claimed?: boolean;
    withinLimit?: boolean;
    jobStatus?: string;
  } = {}) {
    (
      JobRepository as unknown as { TERMINAL_STATUSES: string[] }
    ).TERMINAL_STATUSES = ['done', 'failed', 'cancelled', 'interrupted'];
    (JobRepository as unknown as Mock).mockImplementation(function () {
      return {};
    });
    (FindOrCreateJobUseCase as Mock).mockImplementation(function () {
      return {
        execute: vi
          .fn()
          .mockResolvedValue({ job: { id: 77, status: jobStatus }, created }),
      };
    });
    (ClaimJobForRestartUseCase as Mock).mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue(claimed),
      };
    });
    (CheckJobLimitUseCase as Mock).mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue(withinLimit),
      };
    });
    (CancelJobUseCase as Mock).mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });
    (runConversion as Mock).mockResolvedValue(undefined);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      getNotionAPI: vi.fn(),
    } as any;
    controller = new NotionController(service);
    req = {
      params: { id: pageId },
      query: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      locals: { owner: 'owner1' },
    } as any;
  });

  it('returns blocks even when id refers to a block instead of a page', async () => {
    const validationError = new APIResponseError({
      code: APIErrorCode.ValidationError,
      message: `Provided ID ${pageId} is a block, not a page. Use the retrieve block API instead`,
      status: 400,
      rawBodyText: '',
      headers: {},
    } as any);

    const api = buildApi({
      listBlocksPage: vi.fn().mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false,
      }),
      getPage: vi.fn().mockRejectedValue(validationError),
    });
    (service.getNotionAPI as Mock).mockResolvedValue(api);

    await controller.previewPage(
      req as express.Request,
      res as express.Response
    );

    expect(res.json).toHaveBeenCalledWith({
      blocks: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('skips getPage entirely when parent=block is passed', async () => {
    const getPage = vi.fn();
    const api = buildApi({ getPage });
    (service.getNotionAPI as Mock).mockResolvedValue(api);
    req.query = { parent: 'block' };

    await controller.previewPage(
      req as express.Request,
      res as express.Response
    );

    expect(getPage).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it('includes page title when id refers to a real page', async () => {
    const api = buildApi({
      getPage: vi.fn().mockResolvedValue({
        object: 'page',
        id: pageId,
        parent: { type: 'workspace', workspace: true },
        properties: {
          title: {
            id: 'title',
            type: 'title',
            title: [
              {
                type: 'text',
                plain_text: 'My Page',
                text: { content: 'My Page', link: null },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: 'default',
                },
                href: null,
              },
            ],
          },
        },
        url: 'https://notion.so/My-Page',
        created_time: '',
        last_edited_time: '',
        created_by: { id: 'u', object: 'user' },
        last_edited_by: { id: 'u', object: 'user' },
        cover: null,
        icon: null,
        archived: false,
        in_trash: false,
      }),
    });
    (service.getNotionAPI as Mock).mockResolvedValue(api);

    await controller.previewPage(
      req as express.Request,
      res as express.Response
    );

    const payload = (res.json as Mock).mock.calls[0]?.[0];
    expect(payload.pageTitle).toBe('My Page');
    expect(payload.pageUrl).toBe('https://notion.so/My-Page');
  });

  describe('convert', () => {
    beforeEach(() => {
      req = {
        body: { id: 'page-abc', title: 'Test Page', type: 'page' },
        params: {},
        query: {},
      };
      (service.getNotionAPI as Mock).mockResolvedValue(buildApi());
      vi.spyOn(UsersRepository.prototype, 'getCardUsage').mockResolvedValue({
        cards_used: 0,
        month_started_at: new Date(),
      });
    });

    afterEach(() => {
      (UsersRepository.prototype.getCardUsage as Mock).mockRestore?.();
    });

    it('returns 402 monthly_limit and starts no job when a free user is over the limit', async () => {
      setupConvertMocks();
      vi.spyOn(UsersRepository.prototype, 'getCardUsage').mockResolvedValue({
        cards_used: 200,
        month_started_at: new Date(),
      });

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'monthly_limit', limit: 100 })
      );
      expect(runConversion).not.toHaveBeenCalled();
    });

    it.each(['page', 'database'])(
      'tracks a Notion %s conversion over the limit as conversion_failed from notion',
      async (type) => {
        setupConvertMocks();
        req.body = { ...req.body, type };
        res.locals = { ...res.locals, owner: '42' };
        vi.spyOn(UsersRepository.prototype, 'getCardUsage').mockResolvedValue({
          cards_used: 200,
          month_started_at: new Date(),
        });

        await controller.convert(
          req as express.Request,
          res as express.Response
        );

        expect(track).toHaveBeenCalledWith('conversion_failed', {
          userId: 42,
          anonymousId: null,
          props: expect.objectContaining({
            source: 'notion',
            reason: 'monthly_limit',
            cards_used: 200,
            limit: 100,
          }),
        });
      }
    );

    it('returns 202 with jobId on happy path', async () => {
      setupConvertMocks();

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ jobId: 77, restarted: false });
    });

    it('threads signup_origin from the first_touch cookie into the runConversion payload', async () => {
      setupConvertMocks();
      req.cookies = {
        first_touch: JSON.stringify({ landingPath: '/pricing' }),
      };

      await controller.convert(req as express.Request, res as express.Response);

      expect(runConversion).toHaveBeenCalledWith(
        expect.objectContaining({ signupOrigin: '/pricing' })
      );
    });

    it('passes signupOrigin=null into the runConversion payload when no first_touch cookie is present', async () => {
      setupConvertMocks();

      await controller.convert(req as express.Request, res as express.Response);

      expect(runConversion).toHaveBeenCalledWith(
        expect.objectContaining({ signupOrigin: null })
      );
    });

    it('threads res.locals.requestId into the runConversion payload so worker logs join the request', async () => {
      setupConvertMocks();
      res.locals = { owner: 'owner1', requestId: 'req-abc-123' };

      await controller.convert(req as express.Request, res as express.Response);

      expect(runConversion).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-abc-123' })
      );
    });

    it('emits upload_started so the Notion path enters the upload→download funnel', async () => {
      setupConvertMocks();

      await controller.convert(req as express.Request, res as express.Response);

      expect(track).toHaveBeenCalledWith(
        'upload_started',
        expect.objectContaining({
          userId: null,
          props: expect.objectContaining({ source: 'notion' }),
        })
      );
    });

    it('emits upload_started at funnel entry even when a free user is over the limit', async () => {
      setupConvertMocks();
      vi.spyOn(UsersRepository.prototype, 'getCardUsage').mockResolvedValue({
        cards_used: 200,
        month_started_at: new Date(),
      });

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(track).toHaveBeenCalledWith(
        'upload_started',
        expect.objectContaining({
          props: expect.objectContaining({ source: 'notion' }),
        })
      );
    });

    it('returns restarted: true when re-converting a page whose job row is done', async () => {
      setupConvertMocks({ created: false, claimed: true, jobStatus: 'done' });

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ jobId: 77, restarted: true });
    });

    it('returns 409 and dispatches no conversion when a duplicate is already in flight', async () => {
      setupConvertMocks({
        created: false,
        claimed: false,
        jobStatus: 'started',
      });

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ reason: 'already_in_progress' });
      expect(runConversion).not.toHaveBeenCalled();
    });

    it('returns 402 when free user has hit the limit', async () => {
      setupConvertMocks({ withinLimit: false });

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        reason: 'free_plan_one_at_a_time',
      });
    });

    it('logs and marks the job failed on an unexpected worker rejection so it never sticks in started', async () => {
      setupConvertMocks();
      res.locals = { owner: 'owner1', requestId: 'req-abc-123' };
      const updateJobStatus = vi.fn().mockResolvedValue(undefined);
      (JobRepository as unknown as Mock).mockImplementation(function () {
        return {
          updateJobStatus,
        };
      });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const workerError = new Error('worker boom');
      (runConversion as Mock).mockRejectedValue(workerError);

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(202);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[notion/convert] worker failed',
        expect.objectContaining({
          requestId: 'req-abc-123',
          jobId: 77,
          owner: 'owner1',
          error: workerError,
        })
      );
      expect(updateJobStatus).toHaveBeenCalledWith(
        'page-abc',
        'owner1',
        'failed',
        expect.any(String)
      );
      consoleErrorSpy.mockRestore();
    });

    it('marks the job interrupted when the worker is killed by a pool drain', async () => {
      setupConvertMocks();
      const updateJobStatus = vi.fn().mockResolvedValue(undefined);
      (JobRepository as unknown as Mock).mockImplementation(function () {
        return {
          updateJobStatus,
        };
      });
      const consoleInfoSpy = vi
        .spyOn(console, 'info')
        .mockImplementation(() => undefined);
      (runConversion as Mock).mockRejectedValue(
        new Error('Terminating worker thread')
      );

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(202);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(updateJobStatus).toHaveBeenCalledWith(
        'page-abc',
        'owner1',
        'interrupted',
        WORKER_INTERRUPTED_REASON
      );
      consoleInfoSpy.mockRestore();
    });

    it('marks the job failed and tracks the loss when the conversion process crashes', async () => {
      setupConvertMocks();
      res.locals = { owner: '42', requestId: 'req-crash-1' };
      const updateJobStatus = vi.fn().mockResolvedValue(undefined);
      (JobRepository as unknown as Mock).mockImplementation(function () {
        return {
          updateJobStatus,
        };
      });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      (runConversion as Mock).mockRejectedValue(
        new ConversionChildCrashedError({
          exitCode: 137,
          signal: null,
          lastRssBytes: 2_000_000_000,
          reason: 'conversion_process_crashed',
        })
      );

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(202);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(updateJobStatus).toHaveBeenCalledWith(
        'page-abc',
        '42',
        'failed',
        CONVERSION_PROCESS_CRASHED_REASON
      );
      expect(track).toHaveBeenCalledWith('conversion_failed', {
        userId: 42,
        anonymousId: null,
        props: expect.objectContaining({
          source: 'notion',
          reason: 'conversion_process_crashed',
        }),
      });
      consoleErrorSpy.mockRestore();
    });

    it('logs the request id and owner when the enqueue itself fails', async () => {
      setupConvertMocks();
      res.locals = { owner: 'owner1', requestId: 'req-enqueue-9' };
      (FindOrCreateJobUseCase as Mock).mockImplementation(function () {
        return {
          execute: vi.fn().mockRejectedValue(new Error('db down')),
        };
      });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[notion/convert] enqueue failed',
        expect.objectContaining({
          requestId: 'req-enqueue-9',
          owner: 'owner1',
        })
      );
      consoleErrorSpy.mockRestore();
    });

    it('returns 400 when id is missing', async () => {
      req = { body: {}, params: {}, query: {} };
      (service.getNotionAPI as Mock).mockResolvedValue(buildApi());

      await controller.convert(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('search — Unauthorized', () => {
    it('returns structured JSON with notion_unauthorized code — no HTML in message', async () => {
      const unauthorizedError = new APIResponseError({
        code: APIErrorCode.Unauthorized,
        message: 'API token is invalid.',
        status: 401,
        rawBodyText: '',
        headers: {},
      } as any);
      service = {
        getNotionLinkInfo: vi.fn().mockResolvedValue({ isConnected: true }),
        search: vi.fn().mockRejectedValue(unauthorizedError),
        markTokenInvalid: vi.fn().mockResolvedValue(undefined),
        getNotionAuthorizationLink: vi
          .fn()
          .mockReturnValue('https://notion.so/oauth'),
        getClientId: vi.fn().mockReturnValue('client-abc'),
      } as any;
      controller = new NotionController(service);
      req = { body: { query: 'test' }, params: {}, query: {} };

      await controller.search(req as express.Request, res as express.Response);

      expect(res.status).toHaveBeenCalledWith(401);
      const body = (res.json as Mock).mock.calls[0]?.[0];
      expect(body.code).toBe('notion_unauthorized');
      expect(body.message).not.toMatch(/<a /);
      expect(body.message).not.toMatch(/href/);
    });

    it('invokes MarkNotionTokenInvalidUseCase when Notion returns Unauthorized on search', async () => {
      const unauthorizedError = new APIResponseError({
        code: APIErrorCode.Unauthorized,
        message: 'API token is invalid.',
        status: 401,
        rawBodyText: '',
        headers: {},
      } as any);
      const notionRepo = buildNotionRepo();
      const emailService = buildEmailService();
      service = {
        getNotionLinkInfo: vi.fn().mockResolvedValue({ isConnected: true }),
        search: vi.fn().mockRejectedValue(unauthorizedError),
        markTokenInvalid: vi.fn().mockResolvedValue(undefined),
        getNotionAuthorizationLink: vi
          .fn()
          .mockReturnValue('https://notion.so/oauth'),
        getClientId: vi.fn().mockReturnValue('client-abc'),
      } as any;
      controller = new NotionController(
        service,
        notionRepo,
        buildUsersRepo(),
        emailService
      );
      req = { body: { query: 'test' }, params: {}, query: {} };
      res = { ...res, locals: { owner: 42 } } as any;

      await controller.search(req as express.Request, res as express.Response);

      expect(notionRepo.markTokenInvalid).toHaveBeenCalledWith(42);
    });
  });

  describe('search — empty query', () => {
    it('treats a null query as empty and searches without throwing', async () => {
      const searchResult = { results: [] };
      service = {
        getNotionLinkInfo: vi.fn().mockResolvedValue({ isConnected: true }),
        search: vi.fn().mockResolvedValue(searchResult),
      } as any;
      controller = new NotionController(service);
      req = { body: { query: null }, params: {}, query: {} };

      await controller.search(req as express.Request, res as express.Response);

      expect(service.search).toHaveBeenCalledWith('', 'owner1');
      expect(res.json).toHaveBeenCalledWith(searchResult);
      expect(res.status).not.toHaveBeenCalledWith(500);
    });

    it('treats an absent query as empty and searches without throwing', async () => {
      const searchResult = { results: [] };
      service = {
        getNotionLinkInfo: vi.fn().mockResolvedValue({ isConnected: true }),
        search: vi.fn().mockResolvedValue(searchResult),
      } as any;
      controller = new NotionController(service);
      req = { body: {}, params: {}, query: {} };

      await controller.search(req as express.Request, res as express.Response);

      expect(service.search).toHaveBeenCalledWith('', 'owner1');
      expect(res.json).toHaveBeenCalledWith(searchResult);
      expect(res.status).not.toHaveBeenCalledWith(500);
    });
  });

  describe('searchTopLevelPages — Unauthorized', () => {
    it('returns structured JSON with notion_unauthorized code — no HTML in message', async () => {
      const unauthorizedError = new APIResponseError({
        code: APIErrorCode.Unauthorized,
        message: 'API token is invalid.',
        status: 401,
        rawBodyText: '',
        headers: {},
      } as any);
      service = {
        getNotionLinkInfo: vi.fn().mockResolvedValue({ isConnected: true }),
        searchTopLevelPages: vi.fn().mockRejectedValue(unauthorizedError),
        markTokenInvalid: vi.fn().mockResolvedValue(undefined),
        getNotionAuthorizationLink: vi
          .fn()
          .mockReturnValue('https://notion.so/oauth'),
        getClientId: vi.fn().mockReturnValue('client-abc'),
      } as any;
      controller = new NotionController(service);
      req = { body: { query: 'test' }, params: {}, query: {} };

      await controller.searchTopLevelPages(
        req as express.Request,
        res as express.Response
      );

      expect(res.status).toHaveBeenCalledWith(401);
      const body = (res.json as Mock).mock.calls[0]?.[0];
      expect(body.code).toBe('notion_unauthorized');
      expect(body.message).not.toMatch(/<a /);
      expect(body.message).not.toMatch(/href/);
    });

    it('invokes MarkNotionTokenInvalidUseCase when Notion returns Unauthorized on searchTopLevelPages', async () => {
      const unauthorizedError = new APIResponseError({
        code: APIErrorCode.Unauthorized,
        message: 'API token is invalid.',
        status: 401,
        rawBodyText: '',
        headers: {},
      } as any);
      const notionRepo = buildNotionRepo();
      const emailService = buildEmailService();
      service = {
        getNotionLinkInfo: vi.fn().mockResolvedValue({ isConnected: true }),
        searchTopLevelPages: vi.fn().mockRejectedValue(unauthorizedError),
        markTokenInvalid: vi.fn().mockResolvedValue(undefined),
        getNotionAuthorizationLink: vi
          .fn()
          .mockReturnValue('https://notion.so/oauth'),
        getClientId: vi.fn().mockReturnValue('client-abc'),
      } as any;
      controller = new NotionController(
        service,
        notionRepo,
        buildUsersRepo(),
        emailService
      );
      req = { body: { query: 'test' }, params: {}, query: {} };
      res = { ...res, locals: { owner: 42 } } as any;

      await controller.searchTopLevelPages(
        req as express.Request,
        res as express.Response
      );

      expect(notionRepo.markTokenInvalid).toHaveBeenCalledWith(42);
    });
  });

  describe('getNotionLink', () => {
    it('returns the OAuth link with isConnected=false when the caller is anonymous', async () => {
      service = {
        getClientId: vi.fn().mockReturnValue('client-abc'),
        getNotionLinkInfo: vi.fn().mockResolvedValue({
          link: 'https://api.notion.com/v1/oauth/authorize?client_id=client-abc',
          isConnected: false,
          workspace: null,
        }),
      } as any;
      controller = new NotionController(service);
      res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        locals: {},
      } as any;

      await controller.getNotionLink(
        req as express.Request,
        res as express.Response
      );

      expect(service.getNotionLinkInfo).toHaveBeenCalledWith(undefined);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          link: 'https://api.notion.com/v1/oauth/authorize?client_id=client-abc',
          isConnected: false,
        })
      );
    });

    it('returns isConnected=true with workspace when the caller has a Notion token', async () => {
      service = {
        getClientId: vi.fn().mockReturnValue('client-abc'),
        getNotionLinkInfo: vi.fn().mockResolvedValue({
          link: 'https://api.notion.com/v1/oauth/authorize?client_id=client-abc',
          isConnected: true,
          workspace: 'Pristine Shrestha’s Notion',
        }),
      } as any;
      controller = new NotionController(service);

      await controller.getNotionLink(
        req as express.Request,
        res as express.Response
      );

      expect(service.getNotionLinkInfo).toHaveBeenCalledWith('owner1');
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          isConnected: true,
          workspace: 'Pristine Shrestha’s Notion',
        })
      );
    });

    it('returns 400 when the client ID is not configured', async () => {
      service = {
        getClientId: vi.fn().mockReturnValue(undefined),
        getNotionLinkInfo: vi.fn(),
      } as any;
      controller = new NotionController(service);

      await controller.getNotionLink(
        req as express.Request,
        res as express.Response
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(service.getNotionLinkInfo).not.toHaveBeenCalled();
    });

    it('returns 401 for an anonymous caller when query.client is native', async () => {
      service = {
        getClientId: vi.fn().mockReturnValue('client-abc'),
        getNotionLinkInfo: vi.fn(),
      } as any;
      controller = new NotionController(service);
      req = { params: {}, query: { client: 'native' } };
      res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        locals: {},
      } as any;

      await controller.getNotionLink(
        req as express.Request,
        res as express.Response
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        code: 'auth_required_for_native',
        message: 'Authentication required for native app OAuth flow.',
      });
      expect(service.getNotionLinkInfo).not.toHaveBeenCalled();
    });

    it('threads client=native into the link info when query.client is native', async () => {
      service = {
        getClientId: vi.fn().mockReturnValue('client-abc'),
        getNotionLinkInfo: vi.fn().mockResolvedValue({
          link: 'https://api.notion.com/v1/oauth/authorize?client_id=client-abc&state=native',
          isConnected: false,
          workspace: null,
        }),
      } as any;
      controller = new NotionController(service);
      req = { params: {}, query: { client: 'native' } };

      await controller.getNotionLink(
        req as express.Request,
        res as express.Response
      );

      expect(service.getNotionLinkInfo).toHaveBeenCalledWith('owner1', {
        client: 'native',
      });
      const sent = (res.send as Mock).mock.calls[0]?.[0];
      expect(new URL(sent.link).searchParams.get('state')).toBe('native');
    });

    it('does not pass options for a web caller (no client query)', async () => {
      service = {
        getClientId: vi.fn().mockReturnValue('client-abc'),
        getNotionLinkInfo: vi.fn().mockResolvedValue({
          link: 'https://api.notion.com/v1/oauth/authorize?client_id=client-abc',
          isConnected: false,
          workspace: null,
        }),
      } as any;
      controller = new NotionController(service);
      req = { params: {}, query: {} };

      await controller.getNotionLink(
        req as express.Request,
        res as express.Response
      );

      expect(service.getNotionLinkInfo).toHaveBeenCalledWith('owner1');
      const sent = (res.send as Mock).mock.calls[0]?.[0];
      expect(new URL(sent.link).searchParams.has('state')).toBe(false);
    });
  });

  describe('connect', () => {
    function buildConnectService() {
      return {
        connectToNotion: vi.fn().mockResolvedValue(undefined),
      } as any;
    }

    it('ties the token to the app owner from state, not the browser session', async () => {
      process.env.SECRET = 'controller-secret';
      service = buildConnectService();
      controller = new NotionController(service);
      const appOwnerState = buildNativeOAuthState(7, process.env.SECRET);
      req = { query: { code: 'auth-code', state: appOwnerState } };
      res = {
        redirect: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
        locals: { owner: 99 },
      } as any;

      await controller.connect(req as express.Request, res as express.Response);

      expect(service.connectToNotion).toHaveBeenCalledWith('auth-code', 7);
      expect(res.redirect).toHaveBeenCalledWith(
        'twoanki://x-callback-url/notion-connected'
      );
    });

    it('rejects a tampered native state and never calls connectToNotion', async () => {
      process.env.SECRET = 'controller-secret';
      service = buildConnectService();
      controller = new NotionController(service);
      const tampered = buildNativeOAuthState(7, process.env.SECRET).replace(
        'native:7:',
        'native:8:'
      );
      req = { query: { code: 'auth-code', state: tampered } };
      res = {
        redirect: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
        locals: { owner: 99 },
      } as any;

      await controller.connect(req as express.Request, res as express.Response);

      expect(service.connectToNotion).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'twoanki://x-callback-url/notion-connected?error=invalid_state'
      );
    });

    it('rejects a bare native state with no owner', async () => {
      process.env.SECRET = 'controller-secret';
      service = buildConnectService();
      controller = new NotionController(service);
      req = { query: { code: 'auth-code', state: 'native' } };
      res = {
        redirect: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
        locals: { owner: 99 },
      } as any;

      await controller.connect(req as express.Request, res as express.Response);

      expect(service.connectToNotion).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'twoanki://x-callback-url/notion-connected?error=invalid_state'
      );
    });

    it('redirects to /notion after a web connect with no state', async () => {
      service = buildConnectService();
      controller = new NotionController(service);
      req = { query: { code: 'auth-code' } };
      res = {
        redirect: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
        locals: { owner: 42 },
      } as any;

      await controller.connect(req as express.Request, res as express.Response);

      expect(service.connectToNotion).toHaveBeenCalledWith('auth-code', 42);
      expect(res.redirect).toHaveBeenCalledWith('/notion');
    });

    it('returns 401 and never calls connectToNotion when the owner is missing', async () => {
      service = buildConnectService();
      controller = new NotionController(service);
      req = { query: { code: 'auth-code' } };
      res = {
        redirect: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        locals: {},
      } as any;

      await controller.connect(req as express.Request, res as express.Response);

      expect(service.connectToNotion).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      const body = (res.json as Mock).mock.calls[0]?.[0];
      expect(body.code).toBe('notion_unauthorized');
    });

    it('preserves the login: branch and does not call connectToNotion', async () => {
      service = buildConnectService();
      controller = new NotionController(service);
      req = {
        query: { code: 'auth-code', state: 'login:nonce-1' },
        cookies: { notion_login_state: 'nonce-1' },
      } as any;
      res = {
        redirect: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
        locals: { owner: 42 },
      } as any;

      await controller.connect(req as express.Request, res as express.Response);

      expect(service.connectToNotion).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        '/api/users/auth/notion?code=auth-code'
      );
    });
  });
});
