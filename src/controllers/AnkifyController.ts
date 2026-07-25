import { Request, Response } from 'express';

import ProvisionAnkifyClientUseCase from '../usecases/ankify/ProvisionAnkifyClientUseCase';
import ListAnkifyClientsUseCase from '../usecases/ankify/ListAnkifyClientsUseCase';
import StopAnkifyClientUseCase from '../usecases/ankify/StopAnkifyClientUseCase';
import RespinAnkifyClientUseCase from '../usecases/ankify/RespinAnkifyClientUseCase';
import {
  NoActiveAnkifyClientError,
  SendUploadToRacUseCase,
  UploadNotFoundError,
} from '../usecases/ankify/SendUploadToRacUseCase';
import {
  ExportReviewDataToNotionUseCase,
  MissingTrackerSchemaError,
  NotionNotConnectedError,
} from '../usecases/ankify/ExportReviewDataToNotionUseCase';
import {
  ConfigureExportScheduleUseCase,
  InvalidScheduleTimeError,
  InvalidTimezoneError,
} from '../usecases/ankify/ConfigureExportScheduleUseCase';
import { GetExportScheduleUseCase } from '../usecases/ankify/GetExportScheduleUseCase';
import { DeleteExportScheduleUseCase } from '../usecases/ankify/DeleteExportScheduleUseCase';
import { ListSyncLogsUseCase } from '../usecases/ankify/ListSyncLogsUseCase';
import { ListNotionDatabasesUseCase } from '../usecases/ankify/ListNotionDatabasesUseCase';
import { CreateReviewTrackerDatabaseUseCase } from '../usecases/ankify/CreateReviewTrackerDatabaseUseCase';
import { CheckActiveClientReadinessUseCase } from '../usecases/ankify/CheckActiveClientReadinessUseCase';
import { CheckAnkiWebStatusUseCase } from '../usecases/ankify/CheckAnkiWebStatusUseCase';
import ReissueAnkifySessionUrlUseCase from '../usecases/ankify/ReissueAnkifySessionUrlUseCase';
import { ValidateAnkifySessionTokenUseCase } from '../usecases/ankify/ValidateAnkifySessionTokenUseCase';
import {
  isAnkifyClientOfflineSkip,
  SyncNotionPageToRacUseCase,
} from '../usecases/ankify/SyncNotionPageToRacUseCase';
import {
  RefreshAnkifySubscriptionUseCase,
  RefreshCooldownError,
  SubscriptionNotFoundError,
} from '../usecases/ankify/RefreshAnkifySubscriptionUseCase';
import { ListNotionSubscriptionsUseCase } from '../usecases/ankify/ListNotionSubscriptionsUseCase';
import { DeleteNotionSubscriptionUseCase } from '../usecases/ankify/DeleteNotionSubscriptionUseCase';
import { ListConflictsUseCase } from '../usecases/ankify/ListConflictsUseCase';
import {
  ConflictNotFoundError,
  ResolveConflictUseCase,
} from '../usecases/ankify/ResolveConflictUseCase';
import {
  ConflictNotFoundForOpenError,
  OpenConflictInAnkiUseCase,
} from '../usecases/ankify/OpenConflictInAnkiUseCase';
import { AnkifyConflictResolution } from '../entities/ankify';
import {
  DockerUnavailableError,
  NoAvailablePortError,
} from '../services/ankify/RacService';
import {
  AnkiConnectUnreachableError,
  AnkiFullSyncRequiredError,
} from '../services/ankify/AnkiConnectClient';
import { sanitizeDeckPath } from '../lib/ankify/transforms/tags';
import { GetAnkifyStatsUseCase } from '../usecases/ankify/GetAnkifyStatsUseCase';
import {
  GetAnkifyActiveProfileUseCase,
  NoActiveAnkifyClientForProfileError,
} from '../usecases/ankify/GetAnkifyActiveProfileUseCase';
import {
  NoActiveAnkifyClientForSyncError,
  SyncToAnkiWebUseCase,
} from '../usecases/ankify/SyncToAnkiWebUseCase';
import {
  DeckNotOwnedError,
  OpenDeckInAnkiUseCase,
} from '../usecases/ankify/OpenDeckInAnkiUseCase';
import { GetDeckMaturityUseCase } from '../usecases/ankify/GetDeckMaturityUseCase';
import { track } from '../services/events/track';
import { ListLeechesUseCase } from '../usecases/ankify/ListLeechesUseCase';
import { EditLeechNoteUseCase } from '../usecases/ankify/EditLeechNoteUseCase';
import { DeleteLeechNoteUseCase } from '../usecases/ankify/DeleteLeechNoteUseCase';
import { ReturnLeechToReviewUseCase } from '../usecases/ankify/ReturnLeechToReviewUseCase';
import { NoteNotOwnedError } from '../usecases/ankify/assertNoteOwned';
import { NoActiveAnkifyClientForLeechError } from '../usecases/ankify/leechClient';
import { AnkiConnectNoteFields } from '../services/ankify/AnkiConnectClient';
import { GetReviewQueueUseCase } from '../usecases/ankify/GetReviewQueueUseCase';
import { GetReviewCardUseCase } from '../usecases/ankify/GetReviewCardUseCase';
import {
  GradeReviewCardUseCase,
  InvalidReviewEaseError,
  NoActiveAnkifyClientForReviewError,
  ReviewCardNotFoundError,
} from '../usecases/ankify/GradeReviewCardUseCase';

const ANKI_CONNECT_UNREACHABLE_MESSAGE =
  'AnkiConnect is unreachable. Make sure the hosted Anki container is healthy.';

const todayUtcDayKey = (): string => new Date().toISOString().slice(0, 10);

function parseTargetDeckField(raw: unknown): string | null | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const cleaned = sanitizeDeckPath(raw);
  return cleaned.length > 0 ? cleaned : null;
}

function readDeckField(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNoteId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const noteId = Number(raw);
  if (!Number.isSafeInteger(noteId)) {
    return null;
  }
  return noteId;
}

function parseCardId(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    return null;
  }
  return raw;
}

function parseLeechFields(raw: unknown): AnkiConnectNoteFields | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const fields: AnkiConnectNoteFields = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      return null;
    }
    fields[name] = value;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

class AnkifyController {
  constructor(
    private readonly provisionUseCase: ProvisionAnkifyClientUseCase,
    private readonly listUseCase: ListAnkifyClientsUseCase,
    private readonly stopUseCase: StopAnkifyClientUseCase,
    private readonly sendUploadUseCase: SendUploadToRacUseCase,
    private readonly respinUseCase: RespinAnkifyClientUseCase,
    private readonly exportReviewDataUseCase: ExportReviewDataToNotionUseCase,
    private readonly configureScheduleUseCase: ConfigureExportScheduleUseCase,
    private readonly getScheduleUseCase: GetExportScheduleUseCase,
    private readonly deleteScheduleUseCase: DeleteExportScheduleUseCase,
    private readonly listSyncLogsUseCase: ListSyncLogsUseCase,
    private readonly syncNotionPageUseCase: SyncNotionPageToRacUseCase,
    private readonly listSubscriptionsUseCase: ListNotionSubscriptionsUseCase,
    private readonly deleteSubscriptionUseCase: DeleteNotionSubscriptionUseCase,
    private readonly refreshSubscriptionUseCase: RefreshAnkifySubscriptionUseCase,
    private readonly listConflictsUseCase: ListConflictsUseCase,
    private readonly resolveConflictUseCase: ResolveConflictUseCase,
    private readonly openConflictInAnkiUseCase: OpenConflictInAnkiUseCase,
    private readonly listNotionDatabasesUseCase: ListNotionDatabasesUseCase,
    private readonly createReviewTrackerUseCase: CreateReviewTrackerDatabaseUseCase,
    private readonly checkReadinessUseCase: CheckActiveClientReadinessUseCase,
    private readonly checkAnkiWebStatusUseCase: CheckAnkiWebStatusUseCase,
    private readonly reissueSessionUrlUseCase: ReissueAnkifySessionUrlUseCase,
    private readonly validateSessionTokenUseCase: ValidateAnkifySessionTokenUseCase,
    private readonly getStatsUseCase: GetAnkifyStatsUseCase,
    private readonly getActiveProfileUseCase: GetAnkifyActiveProfileUseCase,
    private readonly syncToAnkiWebUseCase: SyncToAnkiWebUseCase,
    private readonly openDeckInAnkiUseCase: OpenDeckInAnkiUseCase,
    private readonly getDeckMaturityUseCase: GetDeckMaturityUseCase,
    private readonly listLeechesUseCase: ListLeechesUseCase,
    private readonly editLeechNoteUseCase: EditLeechNoteUseCase,
    private readonly deleteLeechNoteUseCase: DeleteLeechNoteUseCase,
    private readonly returnLeechToReviewUseCase: ReturnLeechToReviewUseCase,
    private readonly getReviewQueueUseCase: GetReviewQueueUseCase,
    private readonly getReviewCardUseCase: GetReviewCardUseCase,
    private readonly gradeReviewCardUseCase: GradeReviewCardUseCase
  ) {}

  async list(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const clients = await this.listUseCase.execute(owner);
    res.json(clients);
  }

  async provision(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    console.info(
      '[ankify-controller] POST /api/ankify/clients owner=%d',
      owner
    );
    try {
      const { client, created } = await this.provisionUseCase.execute(owner);
      console.info(
        '[ankify-controller] provision returned id=%d created=%s',
        client.id,
        created
      );
      res.status(created ? 201 : 200).json(client);
    } catch (error) {
      if (error instanceof DockerUnavailableError) {
        console.warn(
          '[ankify-controller] DockerUnavailableError:',
          error.message
        );
        res
          .status(503)
          .json({ message: 'Docker daemon is unavailable on this host' });
        return;
      }
      if (error instanceof NoAvailablePortError) {
        console.warn('[ankify-controller] NoAvailablePortError');
        res.status(503).json({ message: 'No available host ports' });
        return;
      }
      console.error('[ankify-controller] unhandled provision error:', error);
      res.status(500).json({
        message: `Provision failed: ${(error as Error).message ?? 'unknown'}`,
      });
    }
  }

  async stop(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: 'Invalid client id' });
      return;
    }
    await this.stopUseCase.execute(id, owner);
    res.status(204).send();
  }

  async respin(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    try {
      const { client } = await this.respinUseCase.execute(owner);
      res.status(200).json(client);
    } catch (error) {
      if (error instanceof DockerUnavailableError) {
        res
          .status(503)
          .json({ message: 'Docker daemon is unavailable on this host' });
        return;
      }
      if (error instanceof NoAvailablePortError) {
        res.status(503).json({ message: 'No available host ports' });
        return;
      }
      throw error;
    }
  }

  async reissueSessionUrl(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: 'Invalid client id' });
      return;
    }
    const client = await this.reissueSessionUrlUseCase.execute(id, owner);
    if (client == null) {
      res.status(404).json({ message: 'Active client not found' });
      return;
    }
    res.status(200).json(client);
  }

  async validateSession(req: Request, res: Response) {
    const expectedProxyAuth = process.env.ANKIFY_PROXY_AUTH_TOKEN;
    if (expectedProxyAuth != null && expectedProxyAuth.length > 0) {
      const provided = req.header('x-proxy-auth');
      if (provided !== expectedProxyAuth) {
        res.status(401).json({ message: 'Invalid proxy auth' });
        return;
      }
    }

    const sessionToken = String(req.header('x-session-token') ?? '').trim();
    const cookieToken =
      typeof req.cookies?.token === 'string' ? req.cookies.token : undefined;

    const result = await this.validateSessionTokenUseCase.execute({
      sessionToken,
      cookieToken,
    });

    if (!result.ok) {
      res.status(result.status).json({ message: result.reason });
      return;
    }
    res.setHeader('X-Backend-Port', String(result.novnc_port));
    res.status(200).end();
  }

  async exportReviewData(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const databaseId = String(req.body?.database_id ?? '').trim();
    if (databaseId.length === 0) {
      res.status(400).json({ message: 'database_id is required' });
      return;
    }
    const dateRangeDays =
      req.body?.date_range_days == null
        ? undefined
        : Number(req.body.date_range_days);

    try {
      const result = await this.exportReviewDataUseCase.execute({
        owner,
        databaseId,
        dateRangeDays,
      });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof NoActiveAnkifyClientError) {
        res.status(409).json({
          message:
            'No active Ankify client. Provision one before exporting review data.',
        });
        return;
      }
      if (error instanceof NotionNotConnectedError) {
        res.status(409).json({ message: 'Notion is not connected' });
        return;
      }
      if (error instanceof MissingTrackerSchemaError) {
        res.status(422).json({
          message: 'Tracker is missing required columns',
          missing: error.missing,
        });
        return;
      }
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({
          message:
            'AnkiConnect is unreachable. Make sure the hosted Anki container is healthy.',
        });
        return;
      }
      throw error;
    }
  }

  async getSchedule(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const schedule = await this.getScheduleUseCase.execute(owner);
    res.status(200).json(schedule);
  }

  async configureSchedule(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const databaseId = String(req.body?.database_id ?? '').trim();
    const timeOfDay = String(req.body?.time_of_day ?? '').trim();
    const timezone = String(req.body?.timezone ?? '').trim();
    const enabled = req.body?.enabled !== false;
    const dateRangeDays =
      req.body?.date_range_days == null
        ? null
        : Number(req.body.date_range_days);

    if (databaseId.length === 0) {
      res.status(400).json({ message: 'database_id is required' });
      return;
    }
    if (timeOfDay.length === 0) {
      res.status(400).json({ message: 'time_of_day is required (HH:MM)' });
      return;
    }
    if (timezone.length === 0) {
      res.status(400).json({ message: 'timezone is required (IANA name)' });
      return;
    }

    try {
      const schedule = await this.configureScheduleUseCase.execute({
        owner,
        databaseId,
        timeOfDay,
        timezone,
        dateRangeDays,
        enabled,
      });
      res.status(200).json(schedule);
    } catch (error) {
      if (
        error instanceof InvalidScheduleTimeError ||
        error instanceof InvalidTimezoneError
      ) {
        res.status(400).json({ message: error.message });
        return;
      }
      throw error;
    }
  }

  async deleteSchedule(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    await this.deleteScheduleUseCase.execute(owner);
    res.status(204).send();
  }

  async listSubscriptions(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const subs = await this.listSubscriptionsUseCase.execute(owner);
    res.status(200).json(subs);
  }

  async subscribeNotionPage(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const notionPageId = String(req.body?.notion_page_id ?? '').trim();
    if (notionPageId.length === 0) {
      res.status(400).json({ message: 'notion_page_id is required' });
      return;
    }
    const rawTitle = req.body?.notion_page_title;
    const rawUrl = req.body?.notion_page_url;
    const rawIcon = req.body?.notion_page_icon;
    const notionPageTitle =
      typeof rawTitle === 'string' && rawTitle.trim().length > 0
        ? rawTitle.trim()
        : undefined;
    const notionPageUrl =
      typeof rawUrl === 'string' && rawUrl.trim().length > 0
        ? rawUrl.trim()
        : undefined;
    const notionPageIcon =
      typeof rawIcon === 'string' && rawIcon.trim().length > 0
        ? rawIcon.trim()
        : undefined;
    const targetDeck = parseTargetDeckField(req.body?.target_deck);
    try {
      const result = await this.syncNotionPageUseCase.execute({
        owner,
        notionPageId,
        notionPageTitle,
        notionPageUrl,
        notionPageIcon,
        targetDeck,
        trigger: 'manual',
      });
      if (isAnkifyClientOfflineSkip(result)) {
        res.status(503).json({ message: 'AnkiConnect is unreachable.' });
        return;
      }
      res.status(200).json({
        subscription: result.subscription,
        created: result.created,
        updated: result.updated,
        conflicts: result.conflicts,
        unchanged: result.unchanged,
        errors: result.errors,
        anki_web_sync: result.ankiWebSync,
        anki_web_sync_error: result.ankiWebSyncError,
        diagnostic: result.diagnostic,
      });
    } catch (error) {
      if (error instanceof NoActiveAnkifyClientError) {
        res.status(409).json({
          message: 'No active Ankify client. Provision one before subscribing.',
        });
        return;
      }
      if (error instanceof NotionNotConnectedError) {
        res.status(409).json({ message: 'Notion is not connected' });
        return;
      }
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({
          message: 'AnkiConnect is unreachable.',
        });
        return;
      }
      throw error;
    }
  }

  async deleteSubscription(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: 'Invalid subscription id' });
      return;
    }
    await this.deleteSubscriptionUseCase.execute(id, owner);
    res.status(204).send();
  }

  async refreshSubscription(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: 'Invalid subscription id' });
      return;
    }
    try {
      const result = await this.refreshSubscriptionUseCase.execute({
        id,
        owner,
      });
      res.status(200).json({
        subscription: result.subscription,
        created: result.created,
        updated: result.updated,
        conflicts: result.conflicts,
        unchanged: result.unchanged,
        errors: result.errors,
        anki_web_sync: result.ankiWebSync,
        anki_web_sync_error: result.ankiWebSyncError,
        diagnostic: result.diagnostic,
      });
    } catch (error) {
      if (error instanceof SubscriptionNotFoundError) {
        res.status(404).json({ message: 'Subscription not found' });
        return;
      }
      if (error instanceof RefreshCooldownError) {
        res
          .status(429)
          .set('Retry-After', String(error.retryAfterSeconds))
          .json({
            message: error.message,
            retry_after_seconds: error.retryAfterSeconds,
          });
        return;
      }
      if (error instanceof NoActiveAnkifyClientError) {
        res.status(409).json({
          message: 'No active Ankify client. Provision one before refreshing.',
        });
        return;
      }
      if (error instanceof NotionNotConnectedError) {
        res.status(409).json({ message: 'Notion is not connected' });
        return;
      }
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({ message: 'AnkiConnect is unreachable.' });
        return;
      }
      throw error;
    }
  }

  async listConflicts(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const status =
      req.query.status == null ? undefined : String(req.query.status);
    const conflicts = await this.listConflictsUseCase.execute(owner, {
      status,
    });
    res.status(200).json(conflicts);
  }

  async resolveConflict(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: 'Invalid conflict id' });
      return;
    }
    const resolution = String(
      req.body?.resolution ?? 'dismissed'
    ) as AnkifyConflictResolution;
    if (
      resolution !== 'keep_notion' &&
      resolution !== 'keep_anki' &&
      resolution !== 'dismissed'
    ) {
      res.status(400).json({
        message: 'resolution must be keep_notion, keep_anki, or dismissed',
      });
      return;
    }
    try {
      await this.resolveConflictUseCase.execute({
        id,
        owner,
        resolution,
      });
      res.status(204).send();
    } catch (error) {
      if (error instanceof ConflictNotFoundError) {
        res.status(404).json({ message: 'Conflict not found' });
        return;
      }
      throw error;
    }
  }

  async openConflictInAnki(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      res.status(400).json({ message: 'Invalid conflict id' });
      return;
    }
    try {
      const result = await this.openConflictInAnkiUseCase.execute({
        id,
        owner,
      });
      track('ankify_open_in_anki_clicked', {
        userId: owner,
        props: { opened: result.opened },
      });
      res.status(200).json({ opened: result.opened });
    } catch (error) {
      if (error instanceof ConflictNotFoundForOpenError) {
        res.status(404).json({ message: 'Conflict not found' });
        return;
      }
      throw error;
    }
  }

  async getStats(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const stats = await this.getStatsUseCase.execute(owner, {
      today: todayUtcDayKey(),
    });
    if (stats.connected) {
      track('ankify_stats_viewed', {
        userId: owner,
        props: {
          reachable: true,
          streak_days: stats.currentStreak,
          reviewed_today: stats.reviewedToday,
          synced_deck_count: stats.decks.length,
        },
      });
    } else {
      track('ankify_stats_viewed', {
        userId: owner,
        props: {
          reachable: false,
          streak_days: 0,
          reviewed_today: 0,
          synced_deck_count: 0,
        },
      });
    }
    res.status(200).json(stats);
  }

  async checkActiveClientReady(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const result = await this.checkReadinessUseCase.execute(owner);
    res.status(200).json(result);
  }

  async checkAnkiWebStatus(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const result = await this.checkAnkiWebStatusUseCase.execute(owner);
    res.status(200).json(result);
  }

  async listNotionDatabases(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    try {
      const databases = await this.listNotionDatabasesUseCase.execute(owner);
      res.status(200).json(databases);
    } catch (error) {
      if (error instanceof NotionNotConnectedError) {
        res.status(409).json({ message: 'Notion is not connected' });
        return;
      }
      throw error;
    }
  }

  async createReviewTracker(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const parentPageId = String(req.body?.parent_page_id ?? '').trim();
    const title =
      req.body?.title == null ? undefined : String(req.body.title).trim();
    if (parentPageId.length === 0) {
      res.status(400).json({ message: 'parent_page_id is required' });
      return;
    }
    try {
      const created = await this.createReviewTrackerUseCase.execute({
        owner,
        parentPageId,
        title,
      });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof NotionNotConnectedError) {
        res.status(409).json({ message: 'Notion is not connected' });
        return;
      }
      throw error;
    }
  }

  async listSyncLogs(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const limit = req.query.limit == null ? undefined : Number(req.query.limit);
    const status =
      req.query.status == null ? undefined : String(req.query.status);
    const logs = await this.listSyncLogsUseCase.execute(owner, {
      limit,
      status,
    });
    res.status(200).json(logs);
  }

  async sendUpload(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const uploadId = Number.parseInt(req.body?.upload_id, 10);
    if (!Number.isFinite(uploadId)) {
      res.status(400).json({ message: 'upload_id is required' });
      return;
    }

    try {
      const result = await this.sendUploadUseCase.execute({
        uploadId,
        owner,
      });
      res.status(200).json({
        deck_names: result.deckNames,
        created: result.created,
        updated: result.updated,
        errors: result.errors,
        anki_web_sync: result.ankiWebSync,
        anki_web_sync_error: result.ankiWebSyncError,
      });
    } catch (error) {
      if (error instanceof UploadNotFoundError) {
        res.status(404).json({ message: 'Upload not found' });
        return;
      }
      if (error instanceof NoActiveAnkifyClientError) {
        res.status(409).json({
          message:
            'No active Ankify client. Provision one before sending uploads.',
        });
        return;
      }
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({
          message:
            'AnkiConnect is unreachable. Make sure the hosted Anki container is healthy.',
        });
        return;
      }
      throw error;
    }
  }

  async getActiveProfile(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    try {
      const result = await this.getActiveProfileUseCase.execute(owner);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof NoActiveAnkifyClientForProfileError) {
        res.status(409).json({
          message: 'No active Ankify client. Provision one first.',
        });
        return;
      }
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
        return;
      }
      throw error;
    }
  }

  async syncToAnkiWeb(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    try {
      await this.syncToAnkiWebUseCase.execute(owner);
      res.status(200).json({ ok: true });
    } catch (error) {
      if (error instanceof NoActiveAnkifyClientForSyncError) {
        res.status(409).json({
          message: 'No active Ankify client. Provision one first.',
        });
        return;
      }
      if (error instanceof AnkiFullSyncRequiredError) {
        res.status(409).json({
          message:
            'Anki wants to fully resync this collection. Open Anki desktop, resolve the sync prompt there, then try again.',
        });
        return;
      }
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
        return;
      }
      throw error;
    }
  }

  async openDeckInAnki(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const deck = readDeckField(req.body?.deck);
    if (deck == null) {
      res.status(400).json({ message: 'deck is required' });
      return;
    }
    try {
      const result = await this.openDeckInAnkiUseCase.execute({ owner, deck });
      res.status(200).json({ opened: result.opened });
    } catch (error) {
      if (error instanceof DeckNotOwnedError) {
        res.status(403).json({ message: 'Deck not found for this user' });
        return;
      }
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
        return;
      }
      throw error;
    }
  }

  async getDeckMaturity(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const deck = readDeckField(req.query?.deck);
    if (deck == null) {
      res.status(400).json({ message: 'deck is required' });
      return;
    }
    try {
      const result = await this.getDeckMaturityUseCase.execute({ owner, deck });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof DeckNotOwnedError) {
        res.status(403).json({ message: 'Deck not found for this user' });
        return;
      }
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
        return;
      }
      throw error;
    }
  }

  private mapLeechActionError(error: unknown, res: Response): boolean {
    if (error instanceof NoteNotOwnedError) {
      res.status(403).json({ message: 'Card not found for this user' });
      return true;
    }
    if (error instanceof NoActiveAnkifyClientForLeechError) {
      res.status(409).json({
        message: 'No active Ankify client. Provision one first.',
      });
      return true;
    }
    if (error instanceof AnkiConnectUnreachableError) {
      res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
      return true;
    }
    return false;
  }

  async listLeeches(_req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const result = await this.listLeechesUseCase.execute({ owner });
    res.status(200).json(result);
  }

  async editLeech(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const noteId = parseNoteId(req.params.noteId);
    if (noteId == null) {
      res.status(400).json({ message: 'Invalid note id' });
      return;
    }
    const fields = parseLeechFields(req.body?.fields);
    if (fields == null) {
      res.status(400).json({ message: 'fields is required' });
      return;
    }
    try {
      await this.editLeechNoteUseCase.execute({ owner, noteId, fields });
      res.status(204).send();
    } catch (error) {
      if (this.mapLeechActionError(error, res)) {
        return;
      }
      throw error;
    }
  }

  async deleteLeech(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const noteId = parseNoteId(req.params.noteId);
    if (noteId == null) {
      res.status(400).json({ message: 'Invalid note id' });
      return;
    }
    try {
      await this.deleteLeechNoteUseCase.execute({ owner, noteId });
      res.status(204).send();
    } catch (error) {
      if (this.mapLeechActionError(error, res)) {
        return;
      }
      throw error;
    }
  }

  async returnLeechToReview(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const noteId = parseNoteId(req.params.noteId);
    if (noteId == null) {
      res.status(400).json({ message: 'Invalid note id' });
      return;
    }
    try {
      const result = await this.returnLeechToReviewUseCase.execute({
        owner,
        noteId,
      });
      res.status(200).json(result);
    } catch (error) {
      if (this.mapLeechActionError(error, res)) {
        return;
      }
      throw error;
    }
  }

  async getReviewQueue(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const deck = readDeckField(req.query?.deck);
    if (deck == null) {
      res.status(400).json({ message: 'deck is required' });
      return;
    }
    try {
      const result = await this.getReviewQueueUseCase.execute({ owner, deck });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
        return;
      }
      throw error;
    }
  }

  async getReviewCard(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const raw = req.query?.cardId;
    const cardId = parseCardId(typeof raw === 'string' ? Number(raw) : raw);
    if (cardId == null) {
      res.status(400).json({ message: 'cardId is required' });
      return;
    }
    try {
      const result = await this.getReviewCardUseCase.execute({ owner, cardId });
      if (!result.connected) {
        res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
        return;
      }
      res.status(200).json({ connected: true, card: result.card });
    } catch (error) {
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
        return;
      }
      throw error;
    }
  }

  async gradeReviewCard(req: Request, res: Response) {
    const owner = res.locals.owner as number;
    const cardId = parseCardId(req.body?.cardId);
    if (cardId == null) {
      res.status(400).json({ message: 'cardId is required' });
      return;
    }
    try {
      await this.gradeReviewCardUseCase.execute({
        owner,
        cardId,
        ease: req.body?.ease,
      });
      res.status(200).json({ graded: true });
    } catch (error) {
      if (error instanceof InvalidReviewEaseError) {
        res.status(400).json({ message: 'ease must be an integer 1-4' });
        return;
      }
      if (error instanceof ReviewCardNotFoundError) {
        res.status(404).json({ message: 'Card not found for this user' });
        return;
      }
      if (error instanceof NoActiveAnkifyClientForReviewError) {
        res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
        return;
      }
      if (error instanceof AnkiConnectUnreachableError) {
        res.status(503).json({ message: ANKI_CONNECT_UNREACHABLE_MESSAGE });
        return;
      }
      throw error;
    }
  }
}

export default AnkifyController;
