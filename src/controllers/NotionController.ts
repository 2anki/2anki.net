import { Request, Response } from 'express';

import { runConversion } from '../lib/conversionPool';
import {
  isWorkerTerminationError,
  WORKER_INTERRUPTED_REASON,
} from '../lib/workerTermination';
import {
  InProgressJobError,
  JobLimitError,
} from '../lib/storage/jobs/helpers/errors';
import JobRepository from '../data_layer/JobRepository';
import { FindOrCreateJobUseCase } from '../usecases/jobs/FindOrCreateJobUseCase';
import { ClaimJobForRestartUseCase } from '../usecases/jobs/ClaimJobForRestartUseCase';
import { CheckJobLimitUseCase } from '../usecases/jobs/CheckJobLimitUseCase';
import { CancelJobUseCase } from '../usecases/jobs/CancelJobUseCase';
import CardOption from '../lib/parser/Settings';
import BlockHandler from '../services/NotionService/BlockHandler/BlockHandler';
import CustomExporter from '../lib/parser/exporters/CustomExporter';
import {
  BlockObjectResponse,
  PageObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import Workspace from '../lib/parser/WorkSpace';
import { blockToStaticMarkup } from '../services/NotionService/helpers/blockToStaticMarkup';
import { toPreviewBlock } from './helpers/toPreviewBlock';
import {
  APIErrorCode,
  APIResponseError,
  isFullBlock,
  isFullPage,
} from '@notionhq/client';
import { getNotionObjectTitle } from 'get-notion-object-title';
import NotionService from '../services/NotionService';
import {
  isNativeOAuthState,
  verifyNativeOAuthState,
} from '../services/NotionService/nativeOAuthState';
import { getDatabase } from '../data_layer';
import { getNotionId } from '../services/NotionService/getNotionId';
import { getOwner } from '../lib/User/getOwner';
import sendErrorResponse from '../lib/sendErrorResponse';
import { isPaying } from '../lib/isPaying';
import { MONTHLY_CARD_LIMIT } from '../lib/limits';
import ParserRules from '../lib/parser/ParserRules';
import { GetDatabasePreviewUseCase } from '../usecases/notion/GetDatabasePreviewUseCase';
import { MarkNotionTokenInvalidUseCase } from '../usecases/notion/MarkNotionTokenInvalidUseCase';
import { INotionRepository } from '../data_layer/NotionRespository';
import { IEmailService } from '../services/EmailService/EmailService';
import UsersRepository from '../data_layer/UsersRepository';
import { track } from '../services/events/track';
import { parseFirstTouch } from './helpers/parseFirstTouch';
import { classifyDevice } from '../lib/analytics/classifyDevice';

const DEFAULT_PREVIEW_PAGE_SIZE = 15;
const MAX_PREVIEW_PAGE_SIZE = 50;
const NATIVE_NOTION_RETURN_URL = 'twoanki://x-callback-url/notion-connected';

function conversionSourceFromType(type?: string): 'notion' | 'google_drive' {
  return type === 'google_drive' ? 'google_drive' : 'notion';
}

function funnelUserId(owner: string): number | null {
  return Number.isFinite(Number(owner)) ? Number(owner) : null;
}

function clampPageSize(input: unknown): number {
  const raw = typeof input === 'string' ? input : '';
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PREVIEW_PAGE_SIZE;
  }
  return Math.min(parsed, MAX_PREVIEW_PAGE_SIZE);
}

type NotionAPI = Awaited<ReturnType<NotionService['getNotionAPI']>>;

async function lookupPageMeta(
  api: NotionAPI,
  id: string
): Promise<{ pageTitle: string; pageUrl: string | null } | null> {
  try {
    const page = await api.getPage(id);
    if (!page || !isFullPage(page as PageObjectResponse)) return null;
    const full = page as PageObjectResponse;
    return {
      pageTitle: getNotionObjectTitle(full, { emoji: true }),
      pageUrl: full.url ?? null,
    };
  } catch (err) {
    if (
      err instanceof APIResponseError &&
      err.code === APIErrorCode.ValidationError
    ) {
      return null;
    }
    throw err;
  }
}

class NotionController {
  constructor(
    private readonly service: NotionService,
    private readonly notionRepo?: INotionRepository,
    private readonly usersRepo?: UsersRepository,
    private readonly emailService?: IEmailService
  ) {}

  private markTokenInvalid(owner: number): void {
    if (
      this.notionRepo != null &&
      this.usersRepo != null &&
      this.emailService != null
    ) {
      void new MarkNotionTokenInvalidUseCase(
        this.notionRepo,
        this.usersRepo,
        this.emailService
      ).execute(owner);
    } else {
      void this.service.markTokenInvalid(owner);
    }
  }

  async connect(req: Request, res: Response) {
    const { code, state } = req.query;
    if (!code) {
      return res.redirect('/notion');
    }

    const stateStr = state as string | undefined;
    if (stateStr?.startsWith('login:')) {
      const nonce = stateStr.slice('login:'.length);
      const expected = req.cookies?.notion_login_state as string | undefined;
      res.clearCookie('notion_login_state');
      if (!nonce || !expected || nonce !== expected) {
        return res.redirect('/login?error=notion_cancelled');
      }
      return res.redirect(
        `/api/users/auth/notion?code=${encodeURIComponent(code as string)}`
      );
    }

    const authorizationCode = code as string;
    if (stateStr != null && isNativeOAuthState(stateStr)) {
      return this.connectNative(authorizationCode, stateStr, res);
    }

    const owner = res.locals.owner;
    if (owner == null) {
      return res.status(401).json({
        code: 'notion_unauthorized',
        message: 'Sign in before connecting Notion.',
      });
    }

    try {
      await this.service.connectToNotion(authorizationCode, owner);
      return res.redirect('/notion');
    } catch (err) {
      console.info('Connect to Notion failed');
      console.error(err);
      return res.redirect('/notion');
    }
  }

  private async connectNative(
    authorizationCode: string,
    stateStr: string,
    res: Response
  ) {
    const owner = verifyNativeOAuthState(stateStr, process.env.SECRET ?? '');
    if (owner == null) {
      return res.redirect(`${NATIVE_NOTION_RETURN_URL}?error=invalid_state`);
    }

    try {
      await this.service.connectToNotion(authorizationCode, owner);
      return res.redirect(NATIVE_NOTION_RETURN_URL);
    } catch (err) {
      console.info('Connect to Notion failed');
      console.error(err);
      return res.redirect(`${NATIVE_NOTION_RETURN_URL}?error=connect_failed`);
    }
  }

  async search(req: Request, res: Response) {
    try {
      const linkInfo = await this.service.getNotionLinkInfo(res.locals.owner);
      if (!linkInfo.isConnected) {
        return res.status(401).json({
          code: 'notion_unauthorized',
          message: 'Notion is not connected.',
        });
      }

      const query = (req.body.query ?? '').toString();
      const result = await this.service.search(query, getOwner(res));
      res.json(result);
    } catch (err) {
      if (
        err instanceof APIResponseError &&
        err.code === APIErrorCode.Unauthorized
      ) {
        this.markTokenInvalid(res.locals.owner);
        return res.status(401).json({
          code: 'notion_unauthorized',
          message: 'API token is invalid.',
        });
      }
      sendErrorResponse(err, res);
    }
  }

  async searchTopLevelPages(req: Request, res: Response) {
    try {
      const linkInfo = await this.service.getNotionLinkInfo(res.locals.owner);
      if (!linkInfo.isConnected) {
        return res.status(401).json({
          code: 'notion_unauthorized',
          message: 'Notion is not connected.',
        });
      }

      const query = typeof req.body?.query === 'string' ? req.body.query : '';
      const result = await this.service.searchTopLevelPages(
        query,
        getOwner(res)
      );
      res.json(result);
    } catch (err) {
      if (
        err instanceof APIResponseError &&
        err.code === APIErrorCode.Unauthorized
      ) {
        this.markTokenInvalid(res.locals.owner);
        return res.status(401).json({
          code: 'notion_unauthorized',
          message: 'API token is invalid.',
        });
      }
      sendErrorResponse(err, res);
    }
  }

  async getNotionLink(req: Request, res: Response) {
    console.debug('/get-notion-link');
    const clientId = this.service.getClientId();

    if (!clientId) {
      return res.status(400).send();
    }

    if (req.query.client === 'native') {
      if (res.locals.owner == null) {
        return res.status(401).json({
          code: 'auth_required_for_native',
          message: 'Authentication required for native app OAuth flow.',
        });
      }
      const nativeLinkInfo = await this.service.getNotionLinkInfo(
        res.locals.owner,
        { client: 'native' }
      );
      return res.status(200).send(nativeLinkInfo);
    }

    const linkInfo = await this.service.getNotionLinkInfo(res.locals.owner);
    return res.status(200).send(linkInfo);
  }

  async convert(req: Request, res: Response) {
    // Auth check: throws when the owner has no Notion token, preserving the
    // pre-refactor 500 response shape. The worker re-fetches the token itself.
    await this.service.getNotionAPI(res.locals.owner);
    const { id, title, type, frontField, backField } = req.body;

    if (!id) {
      return res.status(400).send({ error: 'id is required' });
    }

    const paying = isPaying(res.locals);
    const owner = res.locals.owner as string;
    const database = getDatabase();

    const cookies = req.cookies as Record<string, unknown> | undefined;
    const anonId = cookies?.anon_id;
    track('upload_started', {
      userId: funnelUserId(owner),
      anonymousId:
        typeof anonId === 'string' && anonId.length > 0 ? anonId : null,
      props: {
        source: conversionSourceFromType(type),
        device: classifyDevice(req.headers?.['user-agent']),
        signup_origin: parseFirstTouch(cookies?.first_touch).signupOrigin,
      },
    });

    const safeString = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v : undefined;

    try {
      if (!paying) {
        const usersRepository = new UsersRepository(database);
        const { cards_used } = await usersRepository.getCardUsage(owner);
        if (cards_used >= MONTHLY_CARD_LIMIT) {
          return res.status(402).json({
            reason: 'monthly_limit',
            code: 'monthly_limit',
            cards_used,
            limit: MONTHLY_CARD_LIMIT,
          });
        }
      }

      const jobRepository = new JobRepository(database);

      const findOrCreate = new FindOrCreateJobUseCase(jobRepository);
      const { job, created } = await findOrCreate.execute({
        id,
        owner,
        title: title ?? 'Untitled',
        type: type || 'conversion',
      });

      const restarted = JobRepository.TERMINAL_STATUSES.includes(job.status);

      if (!created) {
        await this.claimExistingJob(jobRepository, id, owner, job.id);
      }

      await this.enforceJobLimit(jobRepository, id, owner, paying);

      const correlation = {
        requestId: safeString(res.locals.requestId),
        jobId: job.id,
        owner,
      };

      runConversion({
        id,
        type,
        owner,
        isPaying: paying,
        title: title ?? 'Untitled',
        jobDbId: job.id,
        frontField: safeString(frontField),
        backField: safeString(backField),
        anonId: safeString(anonId),
        signupOrigin: parseFirstTouch(cookies?.first_touch).signupOrigin,
        requestId: safeString(res.locals.requestId),
      }).catch(async (err: unknown) => {
        if (isWorkerTerminationError(err)) {
          console.info('[notion/convert] worker interrupted by pool drain', {
            ...correlation,
            pageId: id,
          });
          await jobRepository.updateJobStatus(
            id,
            owner,
            'interrupted',
            WORKER_INTERRUPTED_REASON
          );
          return;
        }
        console.error('[notion/convert] worker failed', {
          ...correlation,
          pageId: id,
          error: err,
        });
      });

      return res.status(202).json({ jobId: job.id, restarted });
    } catch (err) {
      if (err instanceof InProgressJobError) {
        return res.status(409).json({ reason: 'already_in_progress' });
      }
      if (err instanceof JobLimitError) {
        return res.status(402).json({ reason: 'free_plan_one_at_a_time' });
      }
      console.error('[notion/convert] enqueue failed', {
        requestId: safeString(res.locals.requestId),
        owner,
        pageId: id,
        error: err,
      });
      return res.status(500).json({ error: 'conversion failed' });
    }
  }

  private async claimExistingJob(
    jobRepository: JobRepository,
    objectId: string,
    owner: string,
    jobId: number
  ): Promise<void> {
    const claimJob = new ClaimJobForRestartUseCase(jobRepository);
    const claimed = await claimJob.execute({ id: objectId, owner });
    if (!claimed) {
      console.info('[event] duplicate_conversion_rejected', {
        owner,
        jobId,
        objectId,
      });
      throw new InProgressJobError(objectId);
    }
  }

  private async enforceJobLimit(
    jobRepository: JobRepository,
    id: string,
    owner: string,
    paying: boolean
  ): Promise<void> {
    const checkLimit = new CheckJobLimitUseCase(jobRepository);
    const maxJobs = paying ? Infinity : 1;
    const withinLimit = await checkLimit.execute({ owner, maxJobs });
    if (!withinLimit) {
      const cancelJob = new CancelJobUseCase(jobRepository);
      await cancelJob.execute({
        id,
        owner,
        reason: 'Free plan — one conversion at a time',
      });
      console.info('[event] paywall_shown', { owner, attemptedJobId: id });
      throw new JobLimitError(owner);
    }
  }

  async getPage(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).send();
    }
    const api = await this.service.getNotionAPI(res.locals.owner);
    const page = await api.getPage(id.replace(/-/g, ''));
    return res.json(page);
  }

  async getBlocks(req: Request, res: Response) {
    const api = await this.service.getNotionAPI(res.locals.owner);
    console.info('[NO_CACHE] - getBlocks');
    const { id } = req.params;
    if (!id) {
      return res.status(400).send();
    }
    const blocks = await api.getBlocks({
      all: isPaying(res.locals),
      createdAt: '',
      lastEditedAt: '',
      id,
      type: 'page',
    });
    res.json(blocks);
  }

  async getBlock(req: Request, res: Response) {
    const api = await this.service.getNotionAPI(res.locals.owner);
    const { id } = req.params;
    if (!id) {
      return res.status(400).send();
    }
    const block = await api.getBlock(id);
    res.json(block);
  }

  async createBlock(req: Request, res: Response) {
    const api = await this.service.getNotionAPI(res.locals.owner);
    const { id } = req.params;
    if (!id) {
      return res.status(400).send();
    }
    const block = await api.createBlock(id, req.body.newBlock);
    res.json(block);
  }

  async deleteBlock(req: Request, res: Response) {
    const api = await this.service.getNotionAPI(res.locals.owner);
    const { id } = req.params;
    if (!id) {
      return res.status(400).send();
    }
    const block = await api.deleteBlock(id);
    return res.json(block);
  }

  async renderBlock(req: Request, res: Response) {
    const { id } = req.params;
    if (!this.service.isValidUUID(id)) {
      return res.status(400).send();
    }
    const query = id.replace(/-/g, '');
    const api = await this.service.getNotionAPI(res.locals.owner);
    const blockId = getNotionId(query) ?? query;
    const block = await api.getBlock(blockId);
    const settings = new CardOption(CardOption.LoadDefaultOptions());
    let handler = new BlockHandler(
      new CustomExporter('x', new Workspace(true, 'fs').location),
      api,
      settings
    );
    await handler.getBackSide(block as BlockObjectResponse, false);
    const frontSide = await blockToStaticMarkup(
      handler,
      block as BlockObjectResponse
    );
    return res.json({ html: frontSide });
  }

  async getDatabase(req: Request, res: Response) {
    const { id } = req.params;
    if (!this.service.isValidUUID(id)) {
      return res.status(400).send();
    }
    try {
      const database = await this.service.getNotionDatabaseBlock(
        id,
        res.locals.owner
      );
      return res.json(database);
    } catch (error) {
      console.info('Get database failed');
      console.error(error);
      res.status(500).json({
        message:
          'Failed to load the Notion database. It may have been deleted or access was revoked.',
      });
    }
  }

  async queryDatabase(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Missing database id.' });
    }
    try {
      const api = await this.service.getNotionAPI(res.locals.owner);
      const results = await api.queryDatabase(id);
      res.json(results);
    } catch (error) {
      console.info('Query database failed');
      console.error(error);
      sendErrorResponse(error, res);
    }
  }

  async previewDatabase(req: Request, res: Response) {
    const rawId = req.params.id;
    if (!rawId) {
      return res.status(400).json({ message: 'Missing database id.' });
    }
    const id = getNotionId(rawId) ?? rawId.replaceAll('-', '');

    try {
      const api = await this.service.getNotionAPI(res.locals.owner);
      const useCase = new GetDatabasePreviewUseCase(api);
      const preview = await useCase.execute(id, res.locals.owner);
      return res.json(preview);
    } catch (error) {
      if (
        error instanceof APIResponseError &&
        error.code === APIErrorCode.ObjectNotFound
      ) {
        return res.status(404).json({
          message:
            'This database is no longer available. It may have been deleted or moved in Notion.',
        });
      }
      console.info('Preview database failed');
      return sendErrorResponse(error, res);
    }
  }

  async previewPage(req: Request, res: Response) {
    const rawId = req.params.id;
    if (!rawId) {
      return res.status(400).json({ message: 'Missing page id.' });
    }
    const id = getNotionId(rawId) ?? rawId.replaceAll('-', '');

    const pageSize = clampPageSize(req.query.page_size);
    const startCursor =
      typeof req.query.cursor === 'string' && req.query.cursor.length > 0
        ? req.query.cursor
        : undefined;
    const parentIsBlock = req.query.parent === 'block';

    try {
      const api = await this.service.getNotionAPI(res.locals.owner);
      const [response, rules] = await Promise.all([
        api.listBlocksPage(id, { pageSize, startCursor }),
        ParserRules.Load(res.locals.owner, id),
      ]);
      const classifyRules = { flashcardTypes: rules.flaschardTypeNames() };

      const blocks = response.results
        .filter((block): block is BlockObjectResponse => isFullBlock(block))
        .map((block) => toPreviewBlock(block, classifyRules));

      const payload: Record<string, unknown> = {
        blocks,
        nextCursor: response.next_cursor,
        hasMore: response.has_more,
      };

      if (!startCursor && !parentIsBlock) {
        const meta = await lookupPageMeta(api, id);
        if (meta) Object.assign(payload, meta);
      }

      res.json(payload);
    } catch (error) {
      if (
        error instanceof APIResponseError &&
        error.code === APIErrorCode.ObjectNotFound
      ) {
        return res.status(404).json({
          message:
            "We couldn't find that Notion page. It may have been deleted or access was revoked.",
        });
      }
      console.info('Preview page failed');
      console.error(error);
      sendErrorResponse(error, res);
    }
  }

  async disconnect(_req: Request, res: Response) {
    try {
      const deletion = await this.service.disconnect(res.locals.owner);
      res.status(200).send({ didDelete: deletion });
    } catch (err) {
      console.info('Disconnect from Notion failed');
      console.error(err);
      res.status(500).send({ didDelete: false });
    }
  }
}

export default NotionController;
