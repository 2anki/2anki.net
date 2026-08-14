import fs from 'node:fs';
import StorageHandler from '../../StorageHandler';
import { Knex } from 'knex';
import NotionAPIWrapper from '../../../../services/NotionService/NotionAPIWrapper';
import JobRepository from '../../../../data_layer/JobRepository';
import UsersRepository from '../../../../data_layer/UsersRepository';
import UploadRepository from '../../../../data_layer/UploadRespository';
import SettingsRepository from '../../../../data_layer/SettingsRepository';
import ParserRulesRepository from '../../../../data_layer/ParserRulesRepository';
import {
  CheckMonthlyCardLimitUseCase,
  MonthlyLimitError,
} from '../../../../usecases/users/CheckMonthlyCardLimitUseCase';
import { CreateJobWorkSpaceUseCase } from '../../../../usecases/jobs/CreateJobWorkSpaceUseCase';
import { CreateFlashcardsForJobUseCase } from '../../../../usecases/jobs/CreateFlashcardsForJobUseCase';
import { SetJobFailedUseCase } from '../../../../usecases/jobs/SetJobFailedUseCase';
import { BuildDeckForJobUseCase } from '../../../../usecases/jobs/BuildDeckForJobUseCase';
import { CompleteJobUseCase } from '../../../../usecases/jobs/CompleteJobUseCase';
import { NotifyUserUseCase } from '../../../../usecases/jobs/NotifyUserUseCase';
import {
  EMPTY_DECK_FAILURE_REASON,
  isColumnsAmbiguousError,
  isNotionUnauthorizedError,
  jobFailureReasonCode,
  jobFailureReasonFromError,
} from '../../../../usecases/jobs/jobFailureReason';
import { PythonExitError } from '../../../anki/buildPythonExitError';
import { EmptyDeckError } from '../../../../usecases/jobs/EmptyDeckError';
import {
  ConversionRuleScoresRepository,
  type ConversionScoreSource,
} from '../../../../data_layer/ConversionRuleScoresRepository';
import { scoreCandidateDeck } from '../../../parser/scoreCandidateDeck';
import type { InducedRescue } from '../../../parser/induction/candidateRules';
import { track } from '../../../../services/events/track';
import NotionRepository from '../../../../data_layer/NotionRespository';
import { getDefaultEmailService } from '../../../../services/EmailService/EmailService';
import { MarkNotionTokenInvalidUseCase } from '../../../../usecases/notion/MarkNotionTokenInvalidUseCase';
import { UnsupportedNotionBlockRepository } from '../../../../data_layer/UnsupportedNotionBlockRepository';
import { ConversionOutputStatsRepository } from '../../../../data_layer/ConversionOutputStatsRepository';
import { truncateDecksToCardLimit } from '../../../parser/truncateDecksToCardLimit';
import { MonthlyLimitPartial } from '../../../../services/NotionService/helpers/conversionTruncation';
import { toCardCountBucket } from '../../../analytics/cardCountBucket';

type ConversionSource = 'notion' | 'upload' | 'google_drive';

function toConversionSource(type?: string): ConversionSource {
  if (type === 'google_drive') return 'google_drive';
  if (type === 'page') return 'notion';
  return 'upload';
}

interface ConversionRequest {
  title: string;
  api: NotionAPIWrapper;
  id: string;
  owner: string;
  isPaying: boolean;
  type?: string;
  jobDbId: string | number;
  frontField?: string;
  backField?: string;
  anonId?: string;
  signupOrigin?: string | null;
}

function toAnonymousId(anonId?: string): string | null {
  return typeof anonId === 'string' && anonId.length > 0 ? anonId : null;
}

async function recordUnsupportedBlocks(
  database: Knex,
  types: string[]
): Promise<void> {
  if (types == null || types.length === 0) {
    return;
  }
  try {
    await new UnsupportedNotionBlockRepository(database).record(types);
  } catch (error) {
    console.error('[conversion] failed to record unsupported blocks', error);
  }
}

async function recordConversionOutputStats(
  database: Knex,
  delta: { decks: number; cards: number; emptyBack: number }
): Promise<void> {
  try {
    await new ConversionOutputStatsRepository(database).record(
      'convert',
      delta
    );
  } catch (error) {
    console.error(
      '[conversion] failed to record conversion output stats',
      error
    );
  }
}

// The score's entry point, which is finer-grained than toConversionSource above:
// that helper maps only 'page' to notion, so a database or a generic conversion
// job — both Notion — land in 'upload'. Changing it would move existing funnel
// numbers, so the score gets its own mapping rather than a silent redefinition.
function toScoreSource(type?: string): ConversionScoreSource {
  if (type === 'google_drive') return 'google_drive';
  if (type === 'dropbox') return 'dropbox';
  if (type === 'page' || type === 'database' || type === 'conversion') {
    return 'notion';
  }
  return 'upload';
}

// The Notion API path never runs Claude — CreateFlashcardsForJobUseCase walks
// blocks through BlockHandler — so the engine is always the parser here.
async function recordDeckScore(
  database: Knex,
  entry: {
    owner: string;
    type?: string;
    decks: { cards: { name: string; back: string; cloze?: boolean }[] }[];
    cardCount: number;
    // Set only when the empty-deck rescue ran a candidate loop. It carries the
    // winning (or best-attempted) structure and that candidate's own score, so
    // the corpus says which rule rescues Notion, whether it shipped or fell
    // below the floor, and — for a rejected rescue — the shape of the deck the
    // induction actually judged rather than the empty deck that ships.
    induced?: InducedRescue;
  }
): Promise<void> {
  const ownerId = Number(entry.owner);
  const induced = entry.induced;
  try {
    await new ConversionRuleScoresRepository(database).record({
      owner: Number.isFinite(ownerId) ? ownerId : null,
      source: toScoreSource(entry.type),
      engine: 'parser',
      inputFormat: 'notion',
      rule: induced?.rule ?? entry.type ?? 'unknown',
      wasFallback: induced != null,
      outcome:
        induced?.outcome ?? (entry.cardCount > 0 ? 'shipped' : 'no_cards'),
      // A rejected rescue records the rejected candidate's own score; otherwise
      // docChars is 0, because Notion cards come from blocks, not a source
      // document, so coverage and density report 0 rather than a made-up
      // denominator.
      score:
        induced?.score ??
        scoreCandidateDeck(
          entry.decks.flatMap((d) => d.cards),
          0
        ),
    });
  } catch (error) {
    console.error('[conversion] failed to record deck score', error);
  }
}

async function recordConversionTelemetry(
  database: Knex,
  telemetry: {
    unsupportedBlockTypes: string[];
    stats: { decks: number; cards: number; emptyBack: number };
  }
): Promise<void> {
  await recordUnsupportedBlocks(database, telemetry.unsupportedBlockTypes);
  await recordConversionOutputStats(database, telemetry.stats);
}

function trackConversionFailed(
  owner: string,
  anonId: string | undefined,
  type: string | undefined,
  signupOrigin: string | null,
  reasonProps: Record<string, unknown>
): void {
  track('conversion_failed', {
    userId: Number.isFinite(Number(owner)) ? Number(owner) : null,
    anonymousId: toAnonymousId(anonId),
    props: {
      source: toConversionSource(type),
      signup_origin: signupOrigin,
      ...reasonProps,
    },
  });
}

function trackCardLimitPaywall(
  owner: string,
  anonId: string | undefined,
  type: string | undefined
): void {
  track('paywall_shown', {
    userId: Number.isFinite(Number(owner)) ? Number(owner) : null,
    anonymousId: toAnonymousId(anonId),
    props: {
      source: toConversionSource(type),
      kind: 'card_count',
    },
  });
}

export default async function performConversion(
  database: Knex,
  {
    title,
    api,
    id,
    owner,
    isPaying,
    type,
    jobDbId,
    frontField,
    backField,
    anonId,
    signupOrigin,
  }: ConversionRequest
) {
  console.info(`Performing conversion for ${id}`);
  const resolvedSignupOrigin = signupOrigin ?? null;

  const storage = new StorageHandler();
  const jobRepository = new JobRepository(database);
  const usersRepository = new UsersRepository(database);
  const settingsRepository = new SettingsRepository(database);
  const parserRulesRepository = new ParserRulesRepository(database);

  let workspaceLocation: string | undefined;

  try {
    const createWorkSpace = new CreateJobWorkSpaceUseCase(
      jobRepository,
      settingsRepository,
      parserRulesRepository
    );
    const { ws, exporter, settings, bl, rules } = await createWorkSpace.execute(
      { api, id, owner, jobRepository, isPaying }
    );
    workspaceLocation = ws.location;

    const createFlashcards = new CreateFlashcardsForJobUseCase(jobRepository);
    const decks = await createFlashcards.execute({
      bl,
      id,
      owner,
      rules,
      settings,
      type,
      frontField,
      backField,
    });
    if (!decks || decks.length === 0) {
      const setJobFailed = new SetJobFailedUseCase(jobRepository);
      await setJobFailed.execute(
        id,
        owner,
        'No decks created, please try again or contact support with' +
          id +
          '.' +
          String(jobDbId)
      );
      trackConversionFailed(owner, anonId, type, resolvedSignupOrigin, {
        reason: 'no_decks_created',
      });
      return;
    }

    const cardCount = decks.reduce((acc, d) => acc + d.cards.length, 0);
    // Recorded before the empty-deck return so a zero-card Notion conversion
    // still lands a row; without the failures the baseline is only the wins.
    await recordDeckScore(database, {
      owner,
      type,
      decks,
      cardCount,
      induced: bl.inducedRule,
    });
    if (cardCount === 0) {
      const setJobFailed = new SetJobFailedUseCase(jobRepository);
      await setJobFailed.execute(id, owner, EMPTY_DECK_FAILURE_REASON);
      trackConversionFailed(owner, anonId, type, resolvedSignupOrigin, {
        reason: 'empty_deck',
      });
      return;
    }

    const checkMonthlyLimit = new CheckMonthlyCardLimitUseCase(usersRepository);
    let cardLimitPartial: MonthlyLimitPartial | undefined;
    try {
      await checkMonthlyLimit.execute({
        userId: owner,
        candidateCardCount: cardCount,
        isPaying,
      });
    } catch (error) {
      if (!(error instanceof MonthlyLimitError)) {
        throw error;
      }
      const remaining = Math.max(0, error.limit - error.cards_used);
      if (remaining === 0) {
        const setJobFailed = new SetJobFailedUseCase(jobRepository);
        const payload = JSON.stringify({
          code: 'monthly_limit',
          cards_used: error.cards_used,
          limit: error.limit,
          reset_on: error.reset_on,
        });
        await setJobFailed.execute(id, owner, payload);
        trackConversionFailed(owner, anonId, type, resolvedSignupOrigin, {
          reason: 'monthly_limit',
          cards_used: error.cards_used,
          limit: error.limit,
        });
        return;
      }
      const { delivered, heldBack } = truncateDecksToCardLimit(
        decks,
        remaining
      );
      cardLimitPartial = {
        cardsDelivered: delivered,
        cardsHeldBack: heldBack,
        limit: error.limit,
        resetOn: error.reset_on,
      };
    }

    const deliveredCardCount = cardLimitPartial
      ? cardLimitPartial.cardsDelivered
      : cardCount;

    const buildDeck = new BuildDeckForJobUseCase(
      jobRepository,
      new UploadRepository(database)
    );
    const { size, key, apkg } = await buildDeck.execute({
      bl,
      exporter,
      decks,
      ws,
      settings,
      storage,
      id,
      owner,
      type,
    });

    const notifyUser = new NotifyUserUseCase(usersRepository);
    await notifyUser.execute({
      owner,
      rules,
      size,
      key,
      id,
      apkg,
      cardCount: deliveredCardCount,
    });

    const completeJob = new CompleteJobUseCase(jobRepository, usersRepository);
    await completeJob.execute(
      id,
      owner,
      deliveredCardCount,
      bl.truncation,
      bl.droppedAssetCount,
      bl.guessedColumnMapping,
      cardLimitPartial,
      bl.resolvedDatabasePath,
      bl.unsupportedBlockTypeCounts
        ? Object.fromEntries(bl.unsupportedBlockTypeCounts)
        : undefined,
      bl.inducedRule?.outcome === 'rescue_shipped'
        ? bl.inducedRule.rule
        : undefined,
      api.forbiddenBlockCount
    );

    void recordConversionTelemetry(database, {
      unsupportedBlockTypes: bl.unsupportedBlockTypes,
      stats: {
        decks: decks.length,
        cards: cardLimitPartial ? deliveredCardCount : bl.cardCount,
        emptyBack: bl.emptyBackCount,
      },
    });

    if (cardLimitPartial) {
      trackCardLimitPaywall(owner, anonId, type);
    }

    const userId = Number.isFinite(Number(owner)) ? Number(owner) : null;
    track('conversion_succeeded', {
      userId,
      anonymousId: toAnonymousId(anonId),
      props: {
        source: toConversionSource(type),
        card_count_bucket: toCardCountBucket(deliveredCardCount),
        signup_origin: resolvedSignupOrigin,
        ...(cardLimitPartial
          ? {
              card_limit_partial: true,
              cards_held_back: cardLimitPartial.cardsHeldBack,
            }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof PythonExitError) {
      console.error('[conversion] python crash', {
        jobId: id,
        kind: error.kind,
        code: error.code,
        rawOutput: error.rawOutput,
      });
    } else {
      console.error('[conversion] failed', { jobId: id, error });
    }
    if (isNotionUnauthorizedError(error)) {
      const ownerNum = Number(owner);
      if (Number.isFinite(ownerNum)) {
        const notionRepo = new NotionRepository(database);
        await new MarkNotionTokenInvalidUseCase(
          notionRepo,
          new UsersRepository(database),
          getDefaultEmailService()
        ).execute(ownerNum);
      }
    }
    const failedJob = new SetJobFailedUseCase(jobRepository);
    await failedJob.execute(id, owner, jobFailureReasonFromError(error, id));
    trackConversionFailed(owner, anonId, type, resolvedSignupOrigin, {
      reason: jobFailureReasonCode(error),
    });
    const isExpectedUserState =
      error instanceof EmptyDeckError ||
      isColumnsAmbiguousError(error) ||
      isNotionUnauthorizedError(error);
    if (isExpectedUserState) {
      console.info('[conversion] user-input state', {
        jobId: id,
        kind: error instanceof Error ? error.name : 'unknown',
      });
    } else {
      console.error(error);
    }
  } finally {
    if (workspaceLocation != null) {
      try {
        fs.rmSync(workspaceLocation, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('[conversion] workspace cleanup failed', {
          jobId: id,
          message:
            cleanupError instanceof Error ? cleanupError.message : 'unknown',
        });
      }
    }
  }
}
