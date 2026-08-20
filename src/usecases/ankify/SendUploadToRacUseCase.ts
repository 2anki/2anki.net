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

export type AnkiWebSyncStatus = 'synced' | 'failed' | 'skipped';

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

export type ApkgFetcher = (key: string) => Promise<Buffer>;

export interface ParsedApkgForSend {
  collection: NormalizedCollection;
  mediaMap: Map<string, string>;
  mediaEntries: Map<string, Buffer>;
}

export type ApkgParser = (buffer: Buffer) => Promise<ParsedApkgForSend>;

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

export class SendUploadToRacUseCase {
  private readonly modelCacheByClient = new Map<number, Set<string>>();

  constructor(
    private readonly clients: AnkifyClientsRepositoryInterface,
    private readonly mappings: AnkifySyncMappingsRepositoryInterface,
    private readonly uploads: IUploadRepository,
    private readonly fetchApkgBytes: ApkgFetcher,
    private readonly parseApkg: ApkgParser,
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

    const buffer = await this.fetchApkgBytes(upload.key);
    const parsed = await this.parseApkg(buffer);
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
    await this.uploadAllMedia(ac, parsed, result);

    for (const [noteId, note] of collection.notes) {
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

    result.deckNames = Array.from(seenDeckNames);

    await this.runFinalAnkiWebSync(ac, result);
    await this.persistDispatchLog(input, client, result);

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
      if (
        error instanceof AnkiConnectUnreachableError ||
        error instanceof AnkiConnectError
      ) {
        result.errors.push(`Note ${noteId}: ${error.message}`);
      } else {
        result.errors.push(`Note ${noteId}: ${(error as Error).message}`);
      }
    }
  }

  private async uploadAllMedia(
    ac: AnkiConnectClient,
    parsed: ParsedApkgForSend,
    result: SendUploadToRacResult
  ): Promise<void> {
    for (const [originalName, archiveName] of parsed.mediaMap) {
      const bytes = parsed.mediaEntries.get(archiveName);
      if (bytes == null) {
        continue;
      }
      try {
        await ac.storeMediaFile({
          filename: originalName,
          data: bytes.toString('base64'),
        });
      } catch (error) {
        result.errors.push(
          `Media ${originalName}: ${(error as Error).message}`
        );
      }
    }
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
    result: SendUploadToRacResult
  ): Promise<void> {
    if (this.logs == null) {
      return;
    }
    await this.logs
      .log({
        owner: input.owner,
        kind: 'dispatch',
        status: syncLogStatus(result),
        message: `dispatched upload ${input.uploadId} (${result.created} new, ${result.updated} updated, ${result.errors.length} errors)`,
        payload: {
          upload_id: input.uploadId,
          ankify_client_id: client.id,
          deck_names: result.deckNames,
          created: result.created,
          updated: result.updated,
          errors: result.errors,
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
