import {
  AnkifyClient,
  AnkifySyncMapping,
  NewAnkifySyncMapping,
} from '../../entities/ankify';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifySyncMappingsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncMappingsRepository';
import { AnkifySyncLogsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncLogsRepository';
import { syncLogStatus } from '../../lib/ankify/syncLogStatus';
import { IUploadRepository } from '../../data_layer/UploadRespository';
import {
  AnkiConnectClient,
  AnkiConnectError,
  AnkiConnectMalformedResponseError,
  AnkiConnectNote,
  AnkiConnectUnreachableError,
} from '../../services/ankify/AnkiConnectClient';
import {
  ANKIFY_BASIC_MODEL,
  ANKIFY_CLOZE_MODEL,
} from '../../services/ankify/ankifyModels';
import { ensureAnkifyModels } from '../../services/ankify/ensureAnkifyModels';
import {
  AnkifyTemplateOverrides,
  AnkifyTemplateOverridesProvider,
} from '../../services/ankify/templateOverrides';
import {
  NormalizedCollection,
  Note,
} from '../../services/ApkgPreviewService/types';
import type { AnkiWebSyncStatus } from '../../types/ankify/AnkiWebSyncStatus';

export class NoActiveAnkifyClientError extends Error {
  constructor() {
    super('No active Ankify client; provision one first');
    this.name = 'NoActiveAnkifyClientError';
  }
}

export class UploadNotFoundError extends Error {
  constructor() {
    super('Upload not found');
    this.name = 'UploadNotFoundError';
  }
}

export class SendAlreadyRunningError extends Error {
  constructor() {
    super('A send for this account is still running');
    this.name = 'SendAlreadyRunningError';
  }
}

// Bounds how long one send holds its account: after the last check one note
// can still make 3 calls (30s) and the final AnkiWeb sync takes up to 60s, so
// a send ends within 780 + 30 + 60 = 870s. Apache cuts this route's response
// at its global 300s (scripts/deploy-blue-green.sh), so a browser waiting on
// a send this long has already had a proxy error; the dispatch log keeps the
// outcome.
export const SEND_DEADLINE_MS = 13 * 60_000;

const THIN_SPACE = ' ';

const formatCount = (count: number): string =>
  count >= 10000
    ? String(count).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
    : String(count);

export class SendDeadlineExceededError extends Error {
  constructor(
    readonly sent: number,
    readonly total: number
  ) {
    const minutes = Math.round(SEND_DEADLINE_MS / 60_000);
    const noun = total === 1 ? 'note' : 'notes';
    super(
      `Sent ${formatCount(sent)} of ${formatCount(total)} ${noun} before the ${minutes}-minute limit. Split the deck into smaller ones and send each.`
    );
    this.name = 'SendDeadlineExceededError';
  }
}

const isTransportFailure = (error: unknown): boolean =>
  error instanceof AnkiConnectUnreachableError &&
  !(error instanceof AnkiConnectMalformedResponseError);

export type { AnkiWebSyncStatus };

export interface SendUploadToRacResult {
  client: AnkifyClient;
  deckNames: string[];
  created: number;
  updated: number;
  errors: string[];
  ankiWebSync: AnkiWebSyncStatus;
  ankiWebSyncError: string | null;
}

export type AnkiConnectFactory = (
  host: string,
  port: number,
  apiKey: string | null
) => AnkiConnectClient;

export interface ParsedApkgForSend {
  collection: NormalizedCollection;
  mediaMap: Map<string, string>;
  mediaEntries: Map<string, Buffer>;
}

export type ApkgLoader = (key: string) => Promise<ParsedApkgForSend>;

const CLOZE_PATTERN = /\{\{c\d+::/;

const isClozeField = (field: string | undefined): boolean =>
  field != null && CLOZE_PATTERN.test(field);

const buildAnkiConnectNoteFromApkgNote = (input: {
  fields: string[];
  tags: string;
  deckName: string;
  overrides: AnkifyTemplateOverrides | null;
}): AnkiConnectNote => {
  const trimmedTags = input.tags
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (isClozeField(input.fields[0])) {
    return {
      deckName: input.deckName,
      modelName: ANKIFY_CLOZE_MODEL,
      fields: {
        Text: input.fields[0] ?? '',
        'Back Extra': input.fields[1] ?? '',
      },
      tags: trimmedTags,
      options: { allowDuplicate: true },
    };
  }
  const basicModelName = input.overrides?.basicModelName ?? ANKIFY_BASIC_MODEL;
  const basicFields: Record<string, string> = {
    Front: input.fields[0] ?? '',
    Back: input.fields[1] ?? '',
  };
  if (input.overrides) {
    basicFields.MyMedia = '';
  }
  return {
    deckName: input.deckName,
    modelName: basicModelName,
    fields: basicFields,
    tags: trimmedTags,
    options: { allowDuplicate: true },
  };
};

const resolveDeckNameForNote = (
  noteId: number,
  collection: NormalizedCollection,
  fallback: string
): string => {
  const card = collection.cards.find((c) => c.nid === noteId);
  if (card == null) {
    return fallback;
  }
  const deck = collection.decks.get(card.did);
  return deck?.name ?? fallback;
};

interface SendUploadToRacInput {
  uploadId: number;
  owner: number;
  ankiConnectHost?: string;
}

// One send per account at a time: each holds its parsed deck for the whole
// push to Anki, which can take minutes.
export class SendUploadToRacUseCase {
  private readonly modelCacheByClient = new Map<number, Set<string>>();
  private readonly sendsInFlight = new Set<number>();

  constructor(
    private readonly clients: AnkifyClientsRepositoryInterface,
    private readonly mappings: AnkifySyncMappingsRepositoryInterface,
    private readonly uploads: IUploadRepository,
    private readonly loadApkg: ApkgLoader,
    private readonly ankiConnect: AnkiConnectFactory,
    private readonly logs?: AnkifySyncLogsRepositoryInterface,
    private readonly templateOverridesProvider?: AnkifyTemplateOverridesProvider
  ) {}

  private modelCache(clientId: number): Set<string> {
    let cache = this.modelCacheByClient.get(clientId);
    if (cache == null) {
      cache = new Set<string>();
      this.modelCacheByClient.set(clientId, cache);
    }
    return cache;
  }

  async execute(input: SendUploadToRacInput): Promise<SendUploadToRacResult> {
    if (this.sendsInFlight.has(input.owner)) {
      throw new SendAlreadyRunningError();
    }
    this.sendsInFlight.add(input.owner);
    try {
      return await this.send(input);
    } finally {
      this.sendsInFlight.delete(input.owner);
    }
  }

  private async send(
    input: SendUploadToRacInput
  ): Promise<SendUploadToRacResult> {
    const deadline = Date.now() + SEND_DEADLINE_MS;
    const upload = await this.uploads.findByIdAndOwner(
      input.uploadId,
      input.owner
    );
    if (upload == null) {
      throw new UploadNotFoundError();
    }

    const client = await this.clients.findActiveByOwner(input.owner);
    if (client == null) {
      throw new NoActiveAnkifyClientError();
    }
    await this.clients.touchLastActiveAt(client.id);

    const parsed = await this.loadApkg(upload.key);
    const collection = parsed.collection;

    const host = input.ankiConnectHost ?? 'localhost';
    const ac = this.ankiConnect(
      host,
      client.anki_port,
      client.anki_connect_api_key
    );
    const fallbackDeckName =
      (upload.filename ?? '').replace(/\.apkg$/i, '') || 'Imported';

    const seenDeckNames = new Set<string>();
    const result: SendUploadToRacResult = {
      client,
      deckNames: [],
      created: 0,
      updated: 0,
      errors: [],
      ankiWebSync: 'skipped',
      ankiWebSyncError: null,
    };

    const overrides =
      (await this.templateOverridesProvider?.(input.owner)) ?? null;
    await ensureAnkifyModels(ac, this.modelCache(client.id), overrides);

    let reachedDeadline = false;
    try {
      reachedDeadline = !(await this.uploadAllMedia(
        ac,
        parsed,
        result,
        deadline
      ));
      for (const [noteId, note] of collection.notes) {
        if (reachedDeadline || Date.now() > deadline) {
          reachedDeadline = true;
          break;
        }
        await this.processNote({
          noteId,
          note,
          collection,
          client,
          ac,
          fallbackDeckName,
          seenDeckNames,
          result,
          overrides,
        });
      }
    } catch (error) {
      if (isTransportFailure(error)) {
        result.deckNames = Array.from(seenDeckNames);
        await this.persistDispatchLog(
          input,
          client,
          result,
          (error as Error).message
        );
      }
      throw error;
    }

    result.deckNames = Array.from(seenDeckNames);

    await this.runFinalAnkiWebSync(ac, result);
    if (reachedDeadline) {
      const stop = new SendDeadlineExceededError(
        result.created + result.updated,
        collection.notes.size
      );
      await this.persistDispatchLog(input, client, result, stop.message);
      throw stop;
    }
    await this.persistDispatchLog(input, client, result, null);

    return result;
  }

  private async processNote(args: {
    noteId: number;
    note: Note;
    collection: NormalizedCollection;
    client: AnkifyClient;
    ac: AnkiConnectClient;
    fallbackDeckName: string;
    seenDeckNames: Set<string>;
    result: SendUploadToRacResult;
    overrides: AnkifyTemplateOverrides | null;
  }): Promise<void> {
    const {
      noteId,
      note,
      collection,
      client,
      ac,
      fallbackDeckName,
      seenDeckNames,
      result,
      overrides,
    } = args;
    try {
      const deckName = resolveDeckNameForNote(
        noteId,
        collection,
        fallbackDeckName
      );

      if (!seenDeckNames.has(deckName)) {
        await ac.createDeck(deckName);
        seenDeckNames.add(deckName);
      }

      const sourceId = note.guid ?? `apkg-${note.id}`;
      const ankiNote = buildAnkiConnectNoteFromApkgNote({
        fields: note.fields,
        tags: note.tags,
        deckName,
        overrides,
      });

      const existing = await this.mappings.findBySourceId(client.id, sourceId);
      if (existing == null) {
        const ankiNoteId = await ac.addNote(ankiNote);
        await this.upsertMapping({
          ankify_client_id: client.id,
          source_id: sourceId,
          source_type: 'apkg_guid',
          anki_note_id: ankiNoteId,
          deck_name: deckName,
        });
        result.created += 1;
        return;
      }

      try {
        await ac.updateNoteFields(existing.anki_note_id, ankiNote.fields);
        await this.upsertMapping({
          ankify_client_id: client.id,
          source_id: sourceId,
          source_type: existing.source_type,
          anki_note_id: existing.anki_note_id,
          deck_name: deckName,
        });
        result.updated += 1;
      } catch (updateError) {
        if (
          updateError instanceof AnkiConnectError &&
          /not\s*found/i.test(updateError.message)
        ) {
          await this.mappings.deleteByAnkiNoteId(
            client.id,
            existing.anki_note_id
          );
          const ankiNoteId = await ac.addNote(ankiNote);
          await this.upsertMapping({
            ankify_client_id: client.id,
            source_id: sourceId,
            source_type: existing.source_type,
            anki_note_id: ankiNoteId,
            deck_name: deckName,
          });
          result.created += 1;
        } else {
          throw updateError;
        }
      }
    } catch (error) {
      if (isTransportFailure(error)) {
        throw error;
      }
      result.errors.push(`Note ${noteId}: ${(error as Error).message}`);
    }
  }

  private async uploadAllMedia(
    ac: AnkiConnectClient,
    parsed: ParsedApkgForSend,
    result: SendUploadToRacResult,
    deadline: number
  ): Promise<boolean> {
    for (const [originalName, archiveName] of parsed.mediaMap) {
      const bytes = parsed.mediaEntries.get(archiveName);
      if (bytes == null) {
        continue;
      }
      if (Date.now() > deadline) {
        return false;
      }
      try {
        await ac.storeMediaFile({
          filename: originalName,
          data: bytes.toString('base64'),
        });
      } catch (error) {
        if (isTransportFailure(error)) {
          throw error;
        }
        result.errors.push(
          `Media ${originalName}: ${(error as Error).message}`
        );
      }
    }
    return true;
  }

  private async runFinalAnkiWebSync(
    ac: AnkiConnectClient,
    result: SendUploadToRacResult
  ): Promise<void> {
    if (result.created + result.updated === 0) {
      return;
    }
    try {
      await ac.sync();
      result.ankiWebSync = 'synced';
    } catch (error) {
      result.ankiWebSync = 'failed';
      result.ankiWebSyncError = (error as Error).message;
    }
  }

  private async persistDispatchLog(
    input: SendUploadToRacInput,
    client: AnkifyClient,
    result: SendUploadToRacResult,
    stoppedBecause: string | null
  ): Promise<void> {
    if (this.logs == null) {
      return;
    }
    const counts = `${result.created} new, ${result.updated} updated, ${result.errors.length} errors`;
    await this.logs
      .log({
        owner: input.owner,
        kind: 'dispatch',
        status: stoppedBecause == null ? syncLogStatus(result) : 'error',
        message:
          stoppedBecause == null
            ? `dispatched upload ${input.uploadId} (${counts})`
            : `stopped upload ${input.uploadId} (${counts}): ${stoppedBecause}`,
        payload: {
          upload_id: input.uploadId,
          ankify_client_id: client.id,
          deck_names: result.deckNames,
          created: result.created,
          updated: result.updated,
          errors: result.errors,
          ...(stoppedBecause == null ? {} : { stopped: stoppedBecause }),
        },
      })
      .catch((logError) => {
        console.error('[ankify-sync-log] failed to record dispatch', logError);
      });
  }

  private async upsertMapping(
    input: NewAnkifySyncMapping
  ): Promise<AnkifySyncMapping> {
    return this.mappings.upsert(input);
  }
}
