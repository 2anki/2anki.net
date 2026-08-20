import crypto from 'node:crypto';
import instrumentedAxios from '../../services/observability/instrumentedAxios';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifySyncMappingsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncMappingsRepository';
import { AnkifySyncConflictsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncConflictsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { AnkifySyncLogsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncLogsRepository';
import { syncLogStatus } from '../../lib/ankify/syncLogStatus';
import { INotionRepository } from '../../data_layer/NotionRespository';
import { track } from '../../services/events/track';

export type OnTokenInvalidFn = (owner: number) => Promise<void>;
import {
  AnkifyClient,
  AnkifyNotionSubscription,
  AnkifySyncMapping,
  NotionObjectType,
} from '../../entities/ankify';
import {
  AnkiConnectClient,
  AnkiConnectUnreachableError,
  AnkiNoteInfo,
} from '../../services/ankify/AnkiConnectClient';
import {
  ANKIFY_BASIC_MODEL,
  ankifyBasicCreateModelParams,
  ankifyClozeCreateModelParams,
} from '../../services/ankify/ankifyModels';
import { ensureAnkifyModels } from '../../services/ankify/ensureAnkifyModels';
import {
  AnkifyTemplateOverrides,
  AnkifyTemplateOverridesProvider,
  buildBasicModelFromTemplate,
} from '../../services/ankify/templateOverrides';
import {
  walkNotionPageForFlashcards,
  walkNotionDatabaseForFlashcards,
  NotionBlockChildrenFetcher,
  WalkNotionPageResult,
  WalkedNotionFlashcard,
  WalkedNotionMediaRef,
  SyncDiagnostic,
} from '../../services/ankify/notionPageWalker';
import {
  notionDatabasePagesFetcherFactory,
  NotionDatabasePagesFetcherFactory,
} from '../../services/ankify/notionDatabasePagesFetcher';
import { IUnsupportedNotionBlockRepository } from '../../data_layer/UnsupportedNotionBlockRepository';
import { NoActiveAnkifyClientError } from './SendUploadToRacUseCase';
import { NotionNotConnectedError } from './ExportReviewDataToNotionUseCase';
import { isNotionDatabaseNotPageError } from '../../services/NotionService/helpers/isNotionDatabaseNotPageError';
import { isNotionPageNotDatabaseError } from '../../services/NotionService/helpers/isNotionPageNotDatabaseError';
import { sanitizeDeckPath } from '../../lib/ankify/transforms/tags';
import { hashCardContent } from '../../lib/ankify/hashCardContent';
import {
  buildChildDeckName,
  buildDeckName,
} from '../../lib/ankify/transforms/deckName';

export { NotionNotConnectedError } from './ExportReviewDataToNotionUseCase';

export interface SyncNotionPageInput {
  owner: number;
  notionPageId: string;
  notionPageTitle?: string | null;
  notionPageUrl?: string | null;
  notionPageIcon?: string | null;
  targetDeck?: string | null;
  knownObjectType?: NotionObjectType | null;
  trigger: 'manual' | 'polling' | 'webhook';
  ankiConnectHost?: string;
}

export const ANKI_OFFLINE_SKIP_MESSAGE =
  'Anki client offline — will retry next tick';

export class AnkifyClientOfflineSkip {
  readonly skipped = true as const;
  constructor(public readonly subscriptionId: number | null) {}
}

export function isAnkifyClientOfflineSkip(
  value: SyncNotionPageResult | AnkifyClientOfflineSkip
): value is AnkifyClientOfflineSkip {
  return value instanceof AnkifyClientOfflineSkip;
}

export interface NotionPageMeta {
  title: string | null;
  url: string | null;
  icon: string | null;
  objectType?: NotionObjectType | null;
}

export type NotionPageMetaFetcher = (
  token: string
) => (
  notionPageId: string,
  knownObjectType?: NotionObjectType | null
) => Promise<NotionPageMeta>;

export type AnkiWebSyncStatus = 'synced' | 'failed' | 'skipped';

export interface SyncNotionPageResult {
  client: AnkifyClient;
  subscription: AnkifyNotionSubscription;
  created: number;
  updated: number;
  conflicts: number;
  unchanged: number;
  errors: string[];
  ankiWebSync: AnkiWebSyncStatus;
  ankiWebSyncError: string | null;
  diagnostic: SyncDiagnostic | null;
}

interface ModTimePrefilter {
  mappingsByBlock: Map<string, AnkifySyncMapping>;
  skipBlockIds: Set<string>;
  infoByNoteId: Map<number, AnkiNoteInfo>;
}

export type AnkiConnectFactory = (
  host: string,
  port: number,
  apiKey: string | null
) => AnkiConnectClient;

export type NotionFetcherFactory = (
  token: string
) => NotionBlockChildrenFetcher;

const FRONT_FIELD_BASIC = 'Front';
const BACK_FIELD_BASIC = 'Back';
const ANKIFY_MEDIA_PATTERN = 'ankify-*';

export interface AnkifyMediaResponse {
  status: number;
  data: Buffer;
}

export type AnkifyMediaFetcher = (url: string) => Promise<AnkifyMediaResponse>;

const guardedMediaFetcher: AnkifyMediaFetcher = async (url) => {
  const response = await instrumentedAxios.get<Buffer>('notion', url, {
    responseType: 'arraybuffer',
  });
  return { status: response.status, data: Buffer.from(response.data) };
};

export type AnkifyZeroReasonCode =
  | 'empty_page'
  | 'no_matching_blocks'
  | 'all_blocks_unmatched';

const deriveReasonCode = (diagnostic: SyncDiagnostic): AnkifyZeroReasonCode => {
  if (diagnostic.blocks_scanned === 0) {
    return 'empty_page';
  }
  if (
    diagnostic.pattern_hits == null ||
    Object.keys(diagnostic.pattern_hits).length === 0
  ) {
    return 'all_blocks_unmatched';
  }
  return 'no_matching_blocks';
};

const summarizeCardErrors = (errors: string[]): string | null => {
  if (errors.length === 0) {
    return null;
  }
  const noun = errors.length === 1 ? 'card' : 'cards';
  return `${errors.length} ${noun} failed: ${errors[0]}`;
};

function isNotionNotFoundError(error: unknown): boolean {
  return (
    error != null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: unknown }).code === 'object_not_found'
  );
}

function isNotionUnauthorizedError(error: unknown): boolean {
  return (
    error != null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: unknown }).code === 'unauthorized'
  );
}

export class SyncNotionPageToRacUseCase {
  private readonly modelCacheByClient = new Map<number, Set<string>>();

  constructor(
    private readonly clients: AnkifyClientsRepositoryInterface,
    private readonly mappings: AnkifySyncMappingsRepositoryInterface,
    private readonly conflicts: AnkifySyncConflictsRepositoryInterface,
    private readonly subscriptions: AnkifyNotionSubscriptionsRepositoryInterface,
    private readonly logs: AnkifySyncLogsRepositoryInterface,
    private readonly notionRepo: INotionRepository,
    private readonly ankiConnect: AnkiConnectFactory,
    private readonly notionFetcher: NotionFetcherFactory,
    private readonly notionPageMeta?: NotionPageMetaFetcher,
    private readonly mediaFetcher: AnkifyMediaFetcher = guardedMediaFetcher,
    private readonly onTokenInvalid?: OnTokenInvalidFn,
    private readonly templateOverridesProvider?: AnkifyTemplateOverridesProvider,
    private readonly databasePagesFetcher: NotionDatabasePagesFetcherFactory = notionDatabasePagesFetcherFactory,
    private readonly unsupportedBlockRepo?: IUnsupportedNotionBlockRepository
  ) {}

  private modelCache(clientId: number): Set<string> {
    let cache = this.modelCacheByClient.get(clientId);
    if (cache == null) {
      cache = new Set<string>();
      this.modelCacheByClient.set(clientId, cache);
    }
    return cache;
  }

  async execute(
    input: SyncNotionPageInput
  ): Promise<SyncNotionPageResult | AnkifyClientOfflineSkip> {
    const client = await this.clients.findActiveByOwner(input.owner);
    if (client == null) {
      if (input.trigger === 'polling') {
        return this.skipOfflinePoll(input);
      }
      throw new NoActiveAnkifyClientError();
    }
    await this.clients.touchLastActiveAt(client.id);

    const ac = this.buildAnkiConnect(input, client);

    if (
      input.trigger === 'polling' &&
      !(await this.isAnkiConnectReachable(ac))
    ) {
      return this.skipOfflinePoll(input);
    }

    const token = await this.notionRepo.getNotionToken(String(input.owner));
    if (token == null || token.trim().length === 0) {
      throw new NotionNotConnectedError();
    }

    const { pageTitle, pageUrl, pageIcon, resolvedObjectType } =
      await this.resolvePageMeta(token, input);

    const subscription = await this.subscriptions.upsert({
      owner: input.owner,
      ankify_client_id: client.id,
      notion_page_id: input.notionPageId,
      notion_page_title: pageTitle,
      notion_page_url: pageUrl,
      notion_page_icon: pageIcon,
      target_deck: input.targetDeck,
      enabled: true,
    });

    if (resolvedObjectType != null) {
      await this.rememberObjectType(subscription, resolvedObjectType);
    }

    const result: SyncNotionPageResult = {
      client,
      subscription,
      created: 0,
      updated: 0,
      conflicts: 0,
      unchanged: 0,
      errors: [],
      ankiWebSync: 'skipped',
      ankiWebSyncError: null,
      diagnostic: null,
    };

    try {
      await this.runSync({ input, token, client, subscription, result, ac });
      await this.subscriptions.recordPoll(subscription.id, {
        synced: true,
        error: summarizeCardErrors(result.errors),
      });
    } catch (error) {
      const message = (error as Error).message;
      result.errors.push(message);
      await this.subscriptions.recordPoll(subscription.id, {
        error: message,
      });
      if (isNotionNotFoundError(error)) {
        await this.subscriptions.setEnabled(subscription.id, false);
      }
      if (isNotionUnauthorizedError(error)) {
        if (this.onTokenInvalid != null) {
          await this.onTokenInvalid(input.owner);
        } else {
          await this.notionRepo.markTokenInvalid(input.owner);
        }
        await this.subscriptions.setEnabled(subscription.id, false);
      }
      throw error;
    } finally {
      await this.persistSyncLog(input, client, result);
    }

    return result;
  }

  private buildAnkiConnect(
    input: SyncNotionPageInput,
    client: AnkifyClient
  ): AnkiConnectClient {
    return this.ankiConnect(
      input.ankiConnectHost ?? 'localhost',
      client.anki_port,
      client.anki_connect_api_key
    );
  }

  private async isAnkiConnectReachable(
    ac: AnkiConnectClient
  ): Promise<boolean> {
    try {
      await ac.ping();
      return true;
    } catch (error) {
      if (error instanceof AnkiConnectUnreachableError) {
        return false;
      }
      throw error;
    }
  }

  private async skipOfflinePoll(
    input: SyncNotionPageInput
  ): Promise<AnkifyClientOfflineSkip> {
    const existing = await this.subscriptions.findByOwnerAndPageId(
      input.owner,
      input.notionPageId
    );
    if (existing != null) {
      await this.subscriptions.recordPoll(existing.id, {
        error: ANKI_OFFLINE_SKIP_MESSAGE,
      });
    }
    console.info(
      `[ankify-polling] Anki client offline for owner ${input.owner}; skipped Notion fetch`
    );
    return new AnkifyClientOfflineSkip(existing?.id ?? null);
  }

  private async resolvePageMeta(
    token: string,
    input: SyncNotionPageInput
  ): Promise<{
    pageTitle: string | null | undefined;
    pageUrl: string | null | undefined;
    pageIcon: string | null | undefined;
    resolvedObjectType: NotionObjectType | null;
  }> {
    let pageTitle: string | null | undefined = input.notionPageTitle;
    let pageUrl: string | null | undefined = input.notionPageUrl;
    let pageIcon: string | null | undefined = input.notionPageIcon;
    if (this.notionPageMeta == null) {
      return { pageTitle, pageUrl, pageIcon, resolvedObjectType: null };
    }
    try {
      const meta = await this.notionPageMeta(token)(
        input.notionPageId,
        input.knownObjectType ?? null
      );
      pageTitle = meta.title;
      pageUrl = meta.url;
      pageIcon = meta.icon;
      return {
        pageTitle,
        pageUrl,
        pageIcon,
        resolvedObjectType: meta.objectType ?? null,
      };
    } catch {
      return { pageTitle, pageUrl, pageIcon, resolvedObjectType: null };
    }
  }

  private emitZeroCardsEvent(
    input: SyncNotionPageInput,
    diagnostic: SyncDiagnostic
  ): void {
    const reasonCode = deriveReasonCode(diagnostic);
    const pageIdHash = crypto
      .createHash('sha256')
      .update(input.notionPageId)
      .digest('hex');
    track('ankify_zero_cards', {
      userId: input.owner,
      props: {
        source_type: 'notion_page',
        file_hash: pageIdHash,
        parser_path: 'ankify/notionPageWalker',
        reason_code: reasonCode,
        blocks_scanned: diagnostic.blocks_scanned,
        blocks_matched: diagnostic.blocks_matched,
        trigger: input.trigger,
      },
    });
  }

  private async runSync(args: {
    input: SyncNotionPageInput;
    token: string;
    client: AnkifyClient;
    subscription: AnkifyNotionSubscription;
    result: SyncNotionPageResult;
    ac: AnkiConnectClient;
  }): Promise<void> {
    const { input, token, client, subscription, result, ac } = args;
    const fetchChildren = this.notionFetcher(token);
    const walkResult = await this.walkSource(
      input.notionPageId,
      token,
      fetchChildren,
      subscription
    );
    const { cards, diagnostic } = walkResult;
    result.diagnostic = diagnostic;
    this.recordUnsupportedBlocks(walkResult.unsupportedTypes ?? []);

    if (cards.length === 0) {
      this.emitZeroCardsEvent(input, diagnostic);
    }

    const parentDeckName = buildDeckName(
      subscription.target_deck,
      subscription.notion_page_title
    );
    const deckNames = new Set<string>([parentDeckName]);
    for (const card of cards) {
      deckNames.add(this.cardDeckName(parentDeckName, card));
    }
    for (const name of deckNames) {
      await ac.createDeck(name);
    }

    const overridesByPage = await this.resolveCardOverrides(
      input.owner,
      input.notionPageId,
      cards
    );
    await this.ensureModelsForOverrides(ac, client, overridesByPage);

    const existingMediaNames = await this.loadExistingMediaNames(ac);
    const prefilter = await this.buildModTimePrefilter(ac, client, cards);

    for (const card of cards) {
      await this.processCard({
        card,
        client,
        subscription,
        ac,
        input,
        result,
        existingMediaNames,
        deckName: this.cardDeckName(parentDeckName, card),
        overrides: this.overridesForCard(
          overridesByPage,
          card,
          input.notionPageId
        ),
        existing: prefilter.mappingsByBlock.get(card.notion_block_id) ?? null,
        unchangedByModTime: prefilter.skipBlockIds.has(card.notion_block_id),
        prefetchedInfo: prefilter.infoByNoteId,
      });
    }

    await this.consolidateMappedNotes({
      cards,
      client,
      subscription,
      ac,
      input,
      result,
      parentDeckName,
    });

    await this.runFinalAnkiWebSync(ac, result);
  }

  private async probeAnkiConnectActions(
    ac: AnkiConnectClient
  ): Promise<Set<string>> {
    try {
      const actions = await ac.apiReflect();
      return new Set(actions);
    } catch {
      return new Set<string>();
    }
  }

  private async buildModTimePrefilter(
    ac: AnkiConnectClient,
    client: AnkifyClient,
    cards: WalkedNotionFlashcard[]
  ): Promise<ModTimePrefilter> {
    const mappingsByBlock = await this.loadExistingMappings(client, cards);
    const skipBlockIds = new Set<string>();
    const infoByNoteId = new Map<number, AnkiNoteInfo>();
    if (mappingsByBlock.size === 0) {
      return { mappingsByBlock, skipBlockIds, infoByNoteId };
    }

    const actions = await this.probeAnkiConnectActions(ac);
    if (!actions.has('notesModTime')) {
      return { mappingsByBlock, skipBlockIds, infoByNoteId };
    }

    const noteIds = [...mappingsByBlock.values()].map((m) => m.anki_note_id);
    const modTimes = await ac.notesModTime(noteIds);
    const modByNoteId = new Map(modTimes.map((m) => [m.noteId, m.mod]));
    const cardByBlock = new Map(cards.map((c) => [c.notion_block_id, c]));

    const changedNoteIds: number[] = [];
    for (const [blockId, mapping] of mappingsByBlock) {
      const card = cardByBlock.get(blockId);
      if (card == null) {
        continue;
      }
      if (this.isUnchangedSinceLastSync(card, mapping, modByNoteId)) {
        skipBlockIds.add(blockId);
      } else {
        changedNoteIds.push(mapping.anki_note_id);
      }
    }

    if (changedNoteIds.length > 0) {
      const infos = await ac.notesInfo(changedNoteIds);
      for (const info of infos) {
        if (info?.noteId != null) {
          infoByNoteId.set(info.noteId, info);
        }
      }
    }
    return { mappingsByBlock, skipBlockIds, infoByNoteId };
  }

  private async loadExistingMappings(
    client: AnkifyClient,
    cards: WalkedNotionFlashcard[]
  ): Promise<Map<string, AnkifySyncMapping>> {
    const mappingsByBlock = new Map<string, AnkifySyncMapping>();
    for (const card of cards) {
      const mapping = await this.mappings.findBySourceId(
        client.id,
        card.notion_block_id
      );
      if (mapping != null) {
        mappingsByBlock.set(card.notion_block_id, mapping);
      }
    }
    return mappingsByBlock;
  }

  private isUnchangedSinceLastSync(
    card: WalkedNotionFlashcard,
    mapping: AnkifySyncMapping,
    modByNoteId: Map<number, number>
  ): boolean {
    const ankiMod = modByNoteId.get(mapping.anki_note_id);
    if (ankiMod == null) {
      return false;
    }
    const lastSyncedSeconds = Math.floor(
      mapping.last_synced_at.getTime() / 1000
    );
    const notionUnchanged =
      card.notion_last_edited_at.getTime() <= mapping.last_synced_at.getTime();
    const ankiUnchanged = ankiMod <= lastSyncedSeconds;
    const renderUnchanged =
      mapping.content_hash === hashCardContent(card.front, card.back);
    return notionUnchanged && ankiUnchanged && renderUnchanged;
  }

  private cardDeckName(
    parentDeckName: string,
    card: WalkedNotionFlashcard
  ): string {
    if (card.notion_page_id == null) {
      return parentDeckName;
    }
    return buildChildDeckName(parentDeckName, card.notion_page_title);
  }

  private overridesForCard(
    overridesByPage: Map<string, AnkifyTemplateOverrides | null>,
    card: WalkedNotionFlashcard,
    rootPageId: string
  ): AnkifyTemplateOverrides | null {
    return overridesByPage.get(card.notion_page_id ?? rootPageId) ?? null;
  }

  private async resolveCardOverrides(
    owner: number,
    rootPageId: string,
    cards: WalkedNotionFlashcard[]
  ): Promise<Map<string, AnkifyTemplateOverrides | null>> {
    const overridesByPage = new Map<string, AnkifyTemplateOverrides | null>();
    overridesByPage.set(
      rootPageId,
      (await this.templateOverridesProvider?.(owner, rootPageId)) ?? null
    );
    for (const card of cards) {
      const pageId = card.notion_page_id;
      if (pageId == null || overridesByPage.has(pageId)) {
        continue;
      }
      overridesByPage.set(
        pageId,
        (await this.templateOverridesProvider?.(owner, pageId, rootPageId)) ??
          null
      );
    }
    return overridesByPage;
  }

  private async ensureModelsForOverrides(
    ac: AnkiConnectClient,
    client: AnkifyClient,
    overridesByPage: Map<string, AnkifyTemplateOverrides | null>
  ): Promise<void> {
    const seenModels = new Set<string>();
    for (const overrides of overridesByPage.values()) {
      const modelName = overrides?.basicModelName ?? ANKIFY_BASIC_MODEL;
      if (seenModels.has(modelName)) {
        continue;
      }
      seenModels.add(modelName);
      await ensureAnkifyModels(ac, this.modelCache(client.id), overrides);
      await this.refreshAnkifyModelStyling(ac, overrides);
    }
  }

  private async findMisplacedMappingsByDeck(args: {
    cards: WalkedNotionFlashcard[];
    client: AnkifyClient;
    parentDeckName: string;
    targetDeckSet: boolean;
  }): Promise<Map<string, AnkifySyncMapping[]>> {
    const { cards, client, parentDeckName, targetDeckSet } = args;
    const misplacedByDeck = new Map<string, AnkifySyncMapping[]>();
    for (const card of cards) {
      if (card.notion_page_id == null && !targetDeckSet) {
        continue;
      }
      const expectedDeck = this.cardDeckName(parentDeckName, card);
      const mapping = await this.mappings.findBySourceId(
        client.id,
        card.notion_block_id
      );
      if (mapping == null || mapping.deck_name === expectedDeck) {
        continue;
      }
      const group = misplacedByDeck.get(expectedDeck) ?? [];
      group.push(mapping);
      misplacedByDeck.set(expectedDeck, group);
    }
    return misplacedByDeck;
  }

  private async consolidateMappedNotes(args: {
    cards: WalkedNotionFlashcard[];
    client: AnkifyClient;
    subscription: AnkifyNotionSubscription;
    ac: AnkiConnectClient;
    input: SyncNotionPageInput;
    result: SyncNotionPageResult;
    parentDeckName: string;
  }): Promise<void> {
    const { cards, client, subscription, ac, input, result, parentDeckName } =
      args;
    const targetDeckSet = sanitizeDeckPath(subscription.target_deck).length > 0;

    const misplacedByDeck = await this.findMisplacedMappingsByDeck({
      cards,
      client,
      parentDeckName,
      targetDeckSet,
    });

    for (const [deckName, misplaced] of misplacedByDeck) {
      const noteIds = misplaced.map((m) => m.anki_note_id);
      const info = await ac.notesInfo(noteIds);
      const cardIds = info.flatMap((note) => note.cards ?? []);
      if (cardIds.length > 0) {
        await ac.changeDeck(cardIds, deckName);
      }

      for (const mapping of misplaced) {
        await this.mappings.upsert({
          ankify_client_id: client.id,
          source_id: mapping.source_id,
          source_type: mapping.source_type,
          anki_note_id: mapping.anki_note_id,
          deck_name: deckName,
        });
      }

      this.emitFollowedDeckEvent(input, deckName, misplaced.length);
      result.updated += misplaced.length;
    }
  }

  private emitFollowedDeckEvent(
    input: SyncNotionPageInput,
    deckName: string,
    movedNotes: number
  ): void {
    const pageIdHash = crypto
      .createHash('sha256')
      .update(input.notionPageId)
      .digest('hex');
    const deckHash = crypto.createHash('sha256').update(deckName).digest('hex');
    track('ankify_sync_followed_deck', {
      userId: input.owner,
      props: {
        source_type: 'notion_page',
        file_hash: pageIdHash,
        deck_hash: deckHash,
        moved_notes: movedNotes,
        trigger: input.trigger,
      },
    });
  }

  private async walkSource(
    notionId: string,
    token: string,
    fetchChildren: NotionBlockChildrenFetcher,
    subscription: AnkifyNotionSubscription
  ): Promise<WalkNotionPageResult> {
    if (subscription.notion_object_type === 'database') {
      return walkNotionDatabaseForFlashcards(
        notionId,
        fetchChildren,
        this.databasePagesFetcher(token)
      );
    }
    let pageResult: WalkNotionPageResult;
    try {
      pageResult = await walkNotionPageForFlashcards(notionId, fetchChildren);
    } catch (error) {
      if (isNotionDatabaseNotPageError(error)) {
        await this.rememberObjectType(subscription, 'database');
        return walkNotionDatabaseForFlashcards(
          notionId,
          fetchChildren,
          this.databasePagesFetcher(token)
        );
      }
      throw error;
    }
    if (pageResult.cards.length > 0) {
      await this.rememberObjectType(subscription, 'page');
      return pageResult;
    }
    if (subscription.notion_object_type === 'page') {
      return pageResult;
    }
    return this.walkDatabaseOrFallback(
      notionId,
      token,
      fetchChildren,
      pageResult,
      subscription
    );
  }

  private async rememberObjectType(
    subscription: AnkifyNotionSubscription,
    objectType: NotionObjectType
  ): Promise<void> {
    if (subscription.notion_object_type === objectType) {
      return;
    }
    subscription.notion_object_type = objectType;
    await this.subscriptions.recordObjectType(subscription.id, objectType);
  }

  private async walkDatabaseOrFallback(
    notionId: string,
    token: string,
    fetchChildren: NotionBlockChildrenFetcher,
    pageResult: WalkNotionPageResult,
    subscription: AnkifyNotionSubscription
  ): Promise<WalkNotionPageResult> {
    try {
      const databaseResult = await walkNotionDatabaseForFlashcards(
        notionId,
        fetchChildren,
        this.databasePagesFetcher(token)
      );
      if (databaseResult.cards.length > 0) {
        return databaseResult;
      }
      return pageResult;
    } catch (error) {
      if (isNotionPageNotDatabaseError(error)) {
        await this.rememberObjectType(subscription, 'page');
      }
      return pageResult;
    }
  }

  private async loadExistingMediaNames(
    ac: AnkiConnectClient
  ): Promise<Set<string>> {
    try {
      const names = await ac.getMediaFilesNames(ANKIFY_MEDIA_PATTERN);
      return new Set(names);
    } catch {
      return new Set<string>();
    }
  }

  private async uploadCardMedia(
    ac: AnkiConnectClient,
    card: WalkedNotionFlashcard,
    result: SyncNotionPageResult,
    existingMediaNames: Set<string>
  ): Promise<void> {
    for (const ref of card.media) {
      if (ref.filename == null) {
        continue;
      }
      if (existingMediaNames.has(ref.filename)) {
        continue;
      }
      await this.uploadSingleMediaRef(ac, ref, result);
      existingMediaNames.add(ref.filename);
    }
  }

  private async uploadSingleMediaRef(
    ac: AnkiConnectClient,
    ref: WalkedNotionMediaRef,
    result: SyncNotionPageResult
  ): Promise<void> {
    if (ref.filename == null) {
      return;
    }
    try {
      const response = await this.mediaFetcher(ref.url);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      await ac.storeMediaFile({
        filename: ref.filename,
        data: response.data.toString('base64'),
      });
    } catch (error) {
      result.errors.push(
        `${ref.kind} ${ref.block_id}: ${(error as Error).message}`
      );
    }
  }

  private async refreshAnkifyModelStyling(
    ac: AnkiConnectClient,
    overrides: AnkifyTemplateOverrides | null
  ): Promise<void> {
    const basic = overrides
      ? buildBasicModelFromTemplate(
          overrides.basicTemplate,
          overrides.basicModelName
        )
      : ankifyBasicCreateModelParams();
    const cloze = ankifyClozeCreateModelParams();
    await ac.updateModelStyling({ name: basic.modelName, css: basic.css });
    await ac.updateModelStyling({ name: cloze.modelName, css: cloze.css });
    await ac.updateModelTemplates({
      name: basic.modelName,
      templates: Object.fromEntries(
        basic.cardTemplates.map((t) => [
          t.Name,
          { Front: t.Front, Back: t.Back },
        ])
      ),
    });
    await ac.updateModelTemplates({
      name: cloze.modelName,
      templates: Object.fromEntries(
        cloze.cardTemplates.map((t) => [
          t.Name,
          { Front: t.Front, Back: t.Back },
        ])
      ),
    });
  }

  private buildBasicNote(args: {
    deckName: string;
    front: string;
    back: string;
    overrides: AnkifyTemplateOverrides | null;
  }) {
    const modelName = args.overrides?.basicModelName ?? ANKIFY_BASIC_MODEL;
    const fields: Record<string, string> = {
      [FRONT_FIELD_BASIC]: args.front,
      [BACK_FIELD_BASIC]: args.back,
    };
    if (args.overrides) {
      fields.MyMedia = '';
    }
    return {
      deckName: args.deckName,
      modelName,
      fields,
      tags: ['ankify-notion-sync'],
      options: { allowDuplicate: true },
    };
  }

  private async processCard(args: {
    card: WalkedNotionFlashcard;
    client: AnkifyClient;
    subscription: AnkifyNotionSubscription;
    ac: AnkiConnectClient;
    input: SyncNotionPageInput;
    result: SyncNotionPageResult;
    existingMediaNames: Set<string>;
    deckName: string;
    overrides: AnkifyTemplateOverrides | null;
    existing: AnkifySyncMapping | null;
    unchangedByModTime: boolean;
    prefetchedInfo: Map<number, AnkiNoteInfo>;
  }): Promise<void> {
    const {
      card,
      client,
      subscription,
      ac,
      input,
      result,
      existingMediaNames,
      deckName,
      overrides,
      existing,
      unchangedByModTime,
      prefetchedInfo,
    } = args;
    if (existing != null && unchangedByModTime) {
      result.unchanged += 1;
      return;
    }
    try {
      await this.uploadCardMedia(ac, card, result, existingMediaNames);
      if (existing == null) {
        const ankiNoteId = await ac.addNote(
          this.buildBasicNote({
            deckName,
            front: card.front,
            back: card.back,
            overrides,
          })
        );
        await this.mappings.upsert({
          ankify_client_id: client.id,
          source_id: card.notion_block_id,
          source_type: 'notion_block',
          anki_note_id: ankiNoteId,
          deck_name: deckName,
          content_hash: hashCardContent(card.front, card.back),
        });
        result.created += 1;
        return;
      }

      const hasOpenConflict = await this.conflicts.hasPending(
        client.id,
        card.notion_block_id
      );
      if (hasOpenConflict) {
        result.conflicts += 1;
        return;
      }

      await this.reconcileExistingCard({
        card,
        existing,
        client,
        subscription,
        ac,
        input,
        result,
        deckName,
        overrides,
        prefetchedInfo,
      });
    } catch (error) {
      result.errors.push(
        `Block ${card.notion_block_id}: ${(error as Error).message}`
      );
    }
  }

  private async reconcileExistingCard(args: {
    card: WalkedNotionFlashcard;
    existing: AnkifySyncMapping;
    client: AnkifyClient;
    subscription: AnkifyNotionSubscription;
    ac: AnkiConnectClient;
    input: SyncNotionPageInput;
    result: SyncNotionPageResult;
    deckName: string;
    overrides: AnkifyTemplateOverrides | null;
    prefetchedInfo: Map<number, AnkiNoteInfo>;
  }): Promise<void> {
    const { card, existing, client, ac, result, deckName, overrides } = args;
    const lastSyncedAt = existing.last_synced_at;
    const ankiNote =
      args.prefetchedInfo.get(existing.anki_note_id) ??
      (await ac.notesInfo([existing.anki_note_id]))[0];

    if (ankiNote?.noteId == null) {
      await this.mappings.deleteByAnkiNoteId(client.id, existing.anki_note_id);
      const ankiNoteId = await ac.addNote(
        this.buildBasicNote({
          deckName,
          front: card.front,
          back: card.back,
          overrides,
        })
      );
      await this.mappings.upsert({
        ankify_client_id: client.id,
        source_id: card.notion_block_id,
        source_type: existing.source_type,
        anki_note_id: ankiNoteId,
        deck_name: deckName,
        content_hash: hashCardContent(card.front, card.back),
      });
      result.created += 1;
      return;
    }

    const ankiMod = ankiNote.mod ?? null;
    const ankiFront = ankiNote.fields?.[FRONT_FIELD_BASIC]?.value ?? '';
    const ankiBack = ankiNote.fields?.[BACK_FIELD_BASIC]?.value ?? '';
    const lastSyncedSeconds = Math.floor(lastSyncedAt.getTime() / 1000);
    const { subscription, input } = args;

    const renderHash = hashCardContent(card.front, card.back);
    const notionChanged =
      card.notion_last_edited_at.getTime() > lastSyncedAt.getTime();
    const renderChanged = existing.content_hash !== renderHash;
    const ankiChanged = ankiMod != null && ankiMod > lastSyncedSeconds;
    const ankiContentDiffers =
      ankiFront !== card.front || ankiBack !== card.back;

    if (notionChanged && ankiChanged && ankiContentDiffers) {
      await this.conflicts.recordOrFindPending({
        owner: input.owner,
        ankify_client_id: client.id,
        subscription_id: subscription.id,
        source_id: card.notion_block_id,
        anki_note_id: existing.anki_note_id,
        kind: 'both_edited',
        notion_last_edited_at: card.notion_last_edited_at,
        anki_modified_at: ankiMod,
        notion_snapshot: { front: card.front, back: card.back },
        anki_snapshot: { front: ankiFront, back: ankiBack },
      });
      result.conflicts += 1;
      return;
    }

    if ((notionChanged || renderChanged) && ankiContentDiffers) {
      await ac.updateNoteFields(existing.anki_note_id, {
        [FRONT_FIELD_BASIC]: card.front,
        [BACK_FIELD_BASIC]: card.back,
      });
      await this.mappings.upsert({
        ankify_client_id: client.id,
        source_id: card.notion_block_id,
        source_type: existing.source_type,
        anki_note_id: existing.anki_note_id,
        deck_name: existing.deck_name,
        content_hash: renderHash,
      });
      result.updated += 1;
      return;
    }

    if (renderChanged) {
      await this.mappings.upsert({
        ankify_client_id: client.id,
        source_id: card.notion_block_id,
        source_type: existing.source_type,
        anki_note_id: existing.anki_note_id,
        deck_name: existing.deck_name,
        content_hash: renderHash,
      });
    }

    result.unchanged += 1;
  }

  private async runFinalAnkiWebSync(
    ac: AnkiConnectClient,
    result: SyncNotionPageResult
  ): Promise<void> {
    if (result.created + result.updated === 0) {
      return;
    }
    try {
      await ac.sync();
      result.ankiWebSync = 'synced';
    } catch (syncError) {
      result.ankiWebSync = 'failed';
      result.ankiWebSyncError = (syncError as Error).message;
    }
  }

  private recordUnsupportedBlocks(types: string[]): void {
    if (this.unsupportedBlockRepo == null || types.length === 0) {
      return;
    }
    try {
      void this.unsupportedBlockRepo.record(types).catch((error) => {
        console.error(
          '[ankify-sync] failed to record unsupported blocks',
          error
        );
      });
    } catch (error) {
      console.error('[ankify-sync] failed to record unsupported blocks', error);
    }
  }

  private async persistSyncLog(
    input: SyncNotionPageInput,
    client: AnkifyClient,
    result: SyncNotionPageResult
  ): Promise<void> {
    await this.logs
      .log({
        owner: input.owner,
        kind: 'dispatch',
        status: syncLogStatus(result),
        message: `notion-page sync ${input.trigger} for ${input.notionPageId} (created ${result.created}, updated ${result.updated}, conflicts ${result.conflicts})`,
        payload: {
          trigger: input.trigger,
          page_id: input.notionPageId,
          ankify_client_id: client.id,
          created: result.created,
          updated: result.updated,
          conflicts: result.conflicts,
          unchanged: result.unchanged,
          errors: result.errors,
          diagnostic: result.diagnostic,
        },
      })
      .catch((e) => {
        console.error('[ankify-sync-log] failed to record sync', e);
      });
  }
}
