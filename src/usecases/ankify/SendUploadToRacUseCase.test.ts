import { vi, type Mock, type Mocked } from 'vitest';
import {
  NoActiveAnkifyClientError,
  ParsedApkgForSend,
  SEND_DEADLINE_MS,
  SendAlreadyRunningError,
  SendDeadlineExceededError,
  SendUploadToRacUseCase,
  UploadNotFoundError,
} from './SendUploadToRacUseCase';
import { AnkifyClient } from '../../entities/ankify';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifySyncMappingsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncMappingsRepository';
import { IUploadRepository } from '../../data_layer/UploadRespository';
import {
  AnkiConnectClient,
  AnkiConnectError,
  AnkiConnectTimeoutError,
  AnkiConnectUnreachableError,
} from '../../services/ankify/AnkiConnectClient';
import { NormalizedCollection } from '../../services/ApkgPreviewService/types';

const sampleClient = (): AnkifyClient => ({
  id: 1,
  owner: 42,
  container_id: 'c',
  container_name: null,
  anki_port: 20000,
  vnc_port: 21000,
  novnc_port: 22000,
  anki_connect_api_key: null,
  status: 'active',
  created_at: new Date(),
  last_active_at: new Date(),
});

const sampleUpload = () => ({
  id: 7,
  owner: 42,
  filename: 'My Deck.apkg',
  key: 'uploads/my-deck.apkg',
  size_mb: 1,
  object_id: 'abc',
  created_at: new Date(),
});

const buildCollection = (overrides: {
  notes?: Map<
    number,
    { id: number; mid: number; tags: string; fields: string[]; guid?: string }
  >;
  cards?: { id: number; nid: number; did: number; ord: number }[];
  decks?: Map<number, { id: number; name: string }>;
}): NormalizedCollection => ({
  noteTypes: new Map(),
  notes: new Map(
    overrides.notes ??
      new Map([
        [
          100,
          {
            id: 100,
            mid: 1,
            tags: 'notion-sync',
            fields: ['front text', 'back text'],
            guid: 'guid-aaa',
          },
        ],
      ])
  ),
  decks:
    overrides.decks ?? new Map([[10, { id: 10, name: 'Imported::Subdeck' }]]),
  cards: overrides.cards ?? [{ id: 1, nid: 100, did: 10, ord: 0 }],
});

const buildParsed = (
  overrides: Parameters<typeof buildCollection>[0] = {},
  media: {
    mediaMap?: Map<string, string>;
    mediaEntries?: Map<string, Buffer>;
  } = {}
): ParsedApkgForSend => ({
  collection: buildCollection(overrides),
  mediaMap: media.mediaMap ?? new Map(),
  mediaEntries: media.mediaEntries ?? new Map(),
});

const makeAnkiConnectStub = () => {
  const stub = {
    createDeck: vi.fn(async (_d: string) => 1),
    addNote: vi.fn(async (_n: unknown) => 9_876_543_210),
    updateNoteFields: vi.fn(async (_id: number, _f: unknown) => null),
    sync: vi.fn(async () => null),
    modelNames: vi.fn(async () => [] as string[]),
    createModel: vi.fn(async (_p: unknown) => ({ id: 1 })),
    storeMediaFile: vi.fn(async (_p: unknown) => 'ok'),
  };
  return stub as unknown as AnkiConnectClient & typeof stub;
};

const makeRepos = (
  overrides: Partial<{
    activeClient: AnkifyClient | null;
    upload: ReturnType<typeof sampleUpload> | null;
    findMapping: ReturnType<
      AnkifySyncMappingsRepositoryInterface['findBySourceId']
    >;
  }> = {}
): {
  clients: Mocked<AnkifyClientsRepositoryInterface>;
  mappings: Mocked<AnkifySyncMappingsRepositoryInterface>;
  uploads: Mocked<IUploadRepository>;
} => ({
  clients: {
    create: vi.fn(),
    listByOwner: vi.fn(),
    findActiveById: vi.fn(),
    findActiveByOwner: vi.fn(async () =>
      'activeClient' in overrides ? overrides.activeClient! : sampleClient()
    ),
    setStatus: vi.fn(),
    touchLastActiveAt: vi.fn(),
    reservedPorts: vi.fn(),
  } as unknown as Mocked<AnkifyClientsRepositoryInterface>,
  mappings: {
    findBySourceId: vi.fn(async () => (await overrides.findMapping) ?? null),
    upsert: vi.fn(async (input) => ({
      id: 1,
      ankify_client_id: input.ankify_client_id,
      source_id: input.source_id,
      source_type: input.source_type,
      anki_note_id: input.anki_note_id,
      deck_name: input.deck_name,
      content_hash: input.content_hash ?? null,
      last_synced_at: new Date(),
    })),
    listByClient: vi.fn(),
    findByAnkiNoteId: vi.fn(),
    deleteByAnkiNoteId: vi.fn(),
  } as unknown as Mocked<AnkifySyncMappingsRepositoryInterface>,
  uploads: {
    deleteUpload: vi.fn(),
    getUploadsByOwner: vi.fn(),
    findByIdAndOwner: vi.fn(
      async () =>
        (overrides.upload === undefined
          ? sampleUpload()
          : overrides.upload) as never
    ),
    update: vi.fn(),
  } as unknown as Mocked<IUploadRepository>,
});

describe('SendUploadToRacUseCase', () => {
  test('addNote path: creates deck, dispatches new notes, persists mappings', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => buildParsed({}),
      () => ac
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(ac.createDeck).toHaveBeenCalledWith('Imported::Subdeck');
    expect(ac.addNote).toHaveBeenCalledTimes(1);
    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        deckName: 'Imported::Subdeck',
        modelName: 'Ankify Basic',
        fields: { Front: 'front text', Back: 'back text' },
      })
    );
    expect(mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: 'guid-aaa',
        source_type: 'apkg_guid',
        anki_note_id: 9_876_543_210,
        deck_name: 'Imported::Subdeck',
      })
    );
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([]);
    expect(ac.sync).toHaveBeenCalledTimes(1);
    expect(result.ankiWebSync).toBe('synced');
    expect(result.ankiWebSyncError).toBeNull();
  });

  test('AnkiWeb sync failure is captured but does not fail the dispatch', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    (ac.sync as Mock).mockRejectedValueOnce(
      new Error('AnkiWeb account not configured')
    );
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => buildParsed({}),
      () => ac
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(result.created).toBe(1);
    expect(result.ankiWebSync).toBe('failed');
    expect(result.ankiWebSyncError).toContain('AnkiWeb account not configured');
  });

  test('does not call sync when nothing was created or updated', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () =>
        buildParsed({
          notes: new Map(),
          cards: [],
        }),
      () => ac
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(ac.sync).not.toHaveBeenCalled();
    expect(result.ankiWebSync).toBe('skipped');
  });

  test('updateNoteFields path: when mapping exists, updates instead of creating', async () => {
    const existingMapping = {
      id: 1,
      ankify_client_id: 1,
      source_id: 'guid-aaa',
      source_type: 'apkg_guid' as const,
      anki_note_id: 555,
      deck_name: 'Imported::Subdeck',
      content_hash: null,
      last_synced_at: new Date(),
    };
    const { clients, mappings, uploads } = makeRepos({
      findMapping: Promise.resolve(existingMapping),
    });
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => buildParsed({}),
      () => ac
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(ac.addNote).not.toHaveBeenCalled();
    expect(ac.updateNoteFields).toHaveBeenCalledWith(555, {
      Front: 'front text',
      Back: 'back text',
    });
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
  });

  test('orphan recovery: when an existing mapping points to a deleted Anki note, drops the mapping and recreates the note instead of erroring', async () => {
    const existingMapping = {
      id: 1,
      ankify_client_id: 1,
      source_id: 'guid-aaa',
      source_type: 'apkg_guid' as const,
      anki_note_id: 555,
      deck_name: 'Imported::Subdeck',
      content_hash: null,
      last_synced_at: new Date(),
    };
    const { clients, mappings, uploads } = makeRepos({
      findMapping: Promise.resolve(existingMapping),
    });
    const ac = makeAnkiConnectStub();
    (ac.updateNoteFields as Mock).mockRejectedValueOnce(
      new AnkiConnectError('Note was not found: 555')
    );
    (ac.addNote as Mock).mockResolvedValueOnce(7777);

    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => buildParsed({}),
      () => ac
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(mappings.deleteByAnkiNoteId).toHaveBeenCalledWith(1, 555);
    expect(ac.addNote).toHaveBeenCalled();
    expect(mappings.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ anki_note_id: 7777, source_id: 'guid-aaa' })
    );
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test('cloze detection: a {{c1::}} field uses the Cloze model', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () =>
        buildParsed({
          notes: new Map([
            [
              100,
              {
                id: 100,
                mid: 1,
                tags: '',
                fields: ['Capital of {{c1::France}} is Paris.', 'extra'],
                guid: 'guid-cloze',
              },
            ],
          ]),
        }),
      () => ac
    );

    await useCase.execute({ uploadId: 7, owner: 42 });

    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'Ankify Cloze',
        fields: expect.objectContaining({
          Text: 'Capital of {{c1::France}} is Paris.',
          'Back Extra': 'extra',
        }),
      })
    );
  });

  test('seeds Ankify note types once even with multiple notes across decks', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () =>
        buildParsed({
          notes: new Map([
            [
              100,
              {
                id: 100,
                mid: 1,
                tags: '',
                fields: ['front-a', 'back-a'],
                guid: 'guid-a',
              },
            ],
            [
              101,
              {
                id: 101,
                mid: 1,
                tags: '',
                fields: ['Capital of {{c1::France}}', 'extra'],
                guid: 'guid-c',
              },
            ],
          ]),
          decks: new Map([
            [10, { id: 10, name: 'DeckOne' }],
            [11, { id: 11, name: 'DeckTwo' }],
          ]),
          cards: [
            { id: 1, nid: 100, did: 10, ord: 0 },
            { id: 2, nid: 101, did: 11, ord: 0 },
          ],
        }),
      () => ac
    );

    await useCase.execute({ uploadId: 7, owner: 42 });

    expect(ac.modelNames).toHaveBeenCalledTimes(1);
    const created = (ac.createModel as Mock).mock.calls.map(
      (args) => (args[0] as { modelName: string }).modelName
    );
    expect(created).toEqual(
      expect.arrayContaining(['Ankify Basic', 'Ankify Cloze'])
    );
    expect(created).toHaveLength(2);
  });

  test('NoActiveAnkifyClientError when the user has no provisioned client', async () => {
    const { clients, mappings, uploads } = makeRepos({ activeClient: null });
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => buildParsed({}),
      () => ac
    );

    await expect(
      useCase.execute({ uploadId: 7, owner: 42 })
    ).rejects.toBeInstanceOf(NoActiveAnkifyClientError);
  });

  test('UploadNotFoundError when the upload does not belong to the owner', async () => {
    const { clients, mappings, uploads } = makeRepos({ upload: null });
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => buildParsed({}),
      () => ac
    );

    await expect(
      useCase.execute({ uploadId: 7, owner: 42 })
    ).rejects.toBeInstanceOf(UploadNotFoundError);
  });

  test('per-note errors are collected without aborting the run', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    (ac.addNote as Mock)
      .mockRejectedValueOnce(new AnkiConnectError('first failed'))
      .mockResolvedValueOnce(2);
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () =>
        buildParsed({
          notes: new Map([
            [
              100,
              {
                id: 100,
                mid: 1,
                tags: '',
                fields: ['a', 'b'],
                guid: 'guid-1',
              },
            ],
            [
              101,
              {
                id: 101,
                mid: 1,
                tags: '',
                fields: ['c', 'd'],
                guid: 'guid-2',
              },
            ],
          ]),
          cards: [
            { id: 1, nid: 100, did: 10, ord: 0 },
            { id: 2, nid: 101, did: 10, ord: 0 },
          ],
        }),
      () => ac
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('first failed');
  });

  test('uploads each media file via storeMediaFile before adding notes', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    const callOrder: string[] = [];
    (ac.storeMediaFile as Mock).mockImplementation(async (params) => {
      callOrder.push(`store:${(params as { filename: string }).filename}`);
      return 'ok';
    });
    (ac.addNote as Mock).mockImplementation(async () => {
      callOrder.push('addNote');
      return 9_876_543_210;
    });

    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () =>
        buildParsed(
          {},
          {
            mediaMap: new Map([
              ['image.png', '0'],
              ['audio.mp3', '1'],
            ]),
            mediaEntries: new Map([
              ['0', Buffer.from('img-bytes')],
              ['1', Buffer.from('audio-bytes')],
            ]),
          }
        ),
      () => ac
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(ac.storeMediaFile).toHaveBeenCalledTimes(2);
    expect(ac.storeMediaFile).toHaveBeenCalledWith({
      filename: 'image.png',
      data: Buffer.from('img-bytes').toString('base64'),
    });
    expect(ac.storeMediaFile).toHaveBeenCalledWith({
      filename: 'audio.mp3',
      data: Buffer.from('audio-bytes').toString('base64'),
    });
    expect(callOrder).toEqual([
      'store:image.png',
      'store:audio.mp3',
      'addNote',
    ]);
    expect(result.errors).toEqual([]);
  });

  test('per-file storeMediaFile failure is recorded but does not abort dispatch', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    (ac.storeMediaFile as Mock)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce('ok');

    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () =>
        buildParsed(
          {},
          {
            mediaMap: new Map([
              ['broken.png', '0'],
              ['ok.png', '1'],
            ]),
            mediaEntries: new Map([
              ['0', Buffer.from('a')],
              ['1', Buffer.from('b')],
            ]),
          }
        ),
      () => ac
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Media broken.png');
    expect(result.errors[0]).toContain('disk full');
    expect(ac.addNote).toHaveBeenCalledTimes(1);
  });

  test('uses the user’s custom basic model name when templateOverridesProvider returns an override', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => buildParsed({}),
      () => ac,
      undefined,
      async () => ({
        basicModelName: 'ATTI BASIC',
        basicTemplate: {
          parent: 'Basic',
          name: 'ATTI BASIC',
          storageKey: 'n2a-basic',
          front: '{{Front}}',
          back: '{{Back}}',
          styling: '.card {}',
        },
      })
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(result.created).toBe(1);
    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'ATTI BASIC',
        fields: { Front: 'front text', Back: 'back text', MyMedia: '' },
      })
    );
  });

  test('logs a partial dispatch when some cards land and some error', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    (ac.addNote as Mock)
      .mockResolvedValueOnce(9_876_543_210)
      .mockRejectedValueOnce(new AnkiConnectError('duplicate note'));
    const logs = { log: vi.fn(async () => undefined), list: vi.fn() };
    const twoNotes = new Map([
      [
        100,
        {
          id: 100,
          mid: 1,
          tags: 'notion-sync',
          fields: ['front text', 'back text'],
          guid: 'guid-aaa',
        },
      ],
      [
        101,
        {
          id: 101,
          mid: 1,
          tags: 'notion-sync',
          fields: ['front two', 'back two'],
          guid: 'guid-bbb',
        },
      ],
    ]);
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () =>
        buildParsed({
          notes: twoNotes,
          cards: [
            { id: 1, nid: 100, did: 10, ord: 0 },
            { id: 2, nid: 101, did: 10, ord: 0 },
          ],
        }),
      () => ac,
      logs as never
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(logs.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial' })
    );
  });

  test('logs a failed dispatch when no card lands', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    (ac.addNote as Mock).mockRejectedValue(
      new AnkiConnectError('collection locked')
    );
    const logs = { log: vi.fn(async () => undefined), list: vi.fn() };
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => buildParsed({}),
      () => ac,
      logs as never
    );

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(logs.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' })
    );
  });

  test('falls back to Ankify Basic when templateOverridesProvider returns null', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => buildParsed({}),
      () => ac,
      undefined,
      async () => null
    );

    await useCase.execute({ uploadId: 7, owner: 42 });

    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'Ankify Basic',
        fields: { Front: 'front text', Back: 'back text' },
      })
    );
  });

  test('refuses a second send for the same account while the first runs, and takes other accounts', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    let finishLoad: () => void = () => {};
    const loadApkg = vi
      .fn<(key: string) => Promise<ParsedApkgForSend>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLoad = () => resolve(buildParsed({}));
          })
      )
      .mockImplementation(async () => buildParsed({}));
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      loadApkg,
      () => ac
    );

    const first = useCase.execute({ uploadId: 7, owner: 42 });
    await vi.waitFor(() => expect(loadApkg).toHaveBeenCalledTimes(1));

    await expect(
      useCase.execute({ uploadId: 8, owner: 42 })
    ).rejects.toBeInstanceOf(SendAlreadyRunningError);
    await expect(
      useCase.execute({ uploadId: 9, owner: 43 })
    ).resolves.toMatchObject({ created: 1 });
    finishLoad();
    await expect(first).resolves.toMatchObject({ created: 1 });
    await expect(
      useCase.execute({ uploadId: 8, owner: 42 })
    ).resolves.toMatchObject({ created: 1 });
  });

  test('takes a new send for an account once its previous send failed', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    const loadApkg = vi
      .fn<(key: string) => Promise<ParsedApkgForSend>>()
      .mockRejectedValueOnce(new Error('storage dropped the read'))
      .mockImplementation(async () => buildParsed({}));
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      loadApkg,
      () => ac
    );

    await expect(useCase.execute({ uploadId: 7, owner: 42 })).rejects.toThrow(
      'storage dropped the read'
    );
    await expect(
      useCase.execute({ uploadId: 7, owner: 42 })
    ).resolves.toMatchObject({ created: 1 });
  });
});

type AnkiReply = { result: unknown; error: string | null };
type ActionHandler = (signal: AbortSignal) => Promise<AnkiReply>;

const answer =
  (result: unknown): ActionHandler =>
  async () => ({ result, error: null });

const neverAnswer: ActionHandler = (signal) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });

const answerAfter =
  (ms: number, result: unknown): ActionHandler =>
  () =>
    new Promise((resolve) => {
      setTimeout(() => resolve({ result, error: null }), ms);
    });

const makeAnkiContainer = (handlers: Record<string, ActionHandler>) => {
  const calls: string[] = [];
  const fetchImpl = vi.fn(
    async (_url: string, init: { body: string; signal: AbortSignal }) => {
      const { action } = JSON.parse(init.body) as { action: string };
      calls.push(action);
      const handler = handlers[action] ?? answer(null);
      const reply = await handler(init.signal);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => reply,
      };
    }
  ) as unknown as typeof fetch;
  const callsOf = (action: string) => calls.filter((c) => c === action).length;
  return { fetchImpl, handlers, callsOf };
};

const manyNotes = (count: number): Parameters<typeof buildCollection>[0] => {
  const notes = new Map<
    number,
    { id: number; mid: number; tags: string; fields: string[]; guid: string }
  >();
  const cards: { id: number; nid: number; did: number; ord: number }[] = [];
  for (let i = 0; i < count; i++) {
    const id = 1000 + i;
    notes.set(id, {
      id,
      mid: 1,
      tags: '',
      fields: [`front ${i}`, `back ${i}`],
      guid: `guid-${i}`,
    });
    cards.push({ id: 5000 + i, nid: id, did: 10, ord: 0 });
  }
  return { notes, cards };
};

const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error })
  );

describe('SendUploadToRacUseCase when Anki stops answering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const buildUseCase = (
    container: ReturnType<typeof makeAnkiContainer>,
    parsed: ParsedApkgForSend
  ) => {
    const repos = makeRepos();
    const useCase = new SendUploadToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.uploads,
      async () => parsed,
      () => new AnkiConnectClient('http://anki', container.fetchImpl)
    );
    return { useCase, ...repos };
  };

  test('ends the send after the first call that times out, not after every note', async () => {
    const container = makeAnkiContainer({ addNote: neverAnswer });
    const { useCase, mappings } = buildUseCase(
      container,
      buildParsed(manyNotes(3))
    );

    const outcome = settle(useCase.execute({ uploadId: 7, owner: 42 }));
    await vi.advanceTimersByTimeAsync(60_000);
    const { error } = await outcome;

    expect(error).toBeInstanceOf(AnkiConnectTimeoutError);
    expect(container.callsOf('addNote')).toBe(1);
    expect(container.callsOf('sync')).toBe(0);
    expect(mappings.upsert).not.toHaveBeenCalled();
  });

  test('ends the send after the first media upload that times out', async () => {
    const container = makeAnkiContainer({ storeMediaFile: neverAnswer });
    const { useCase } = buildUseCase(
      container,
      buildParsed(manyNotes(1), {
        mediaMap: new Map([
          ['a.png', '0'],
          ['b.png', '1'],
        ]),
        mediaEntries: new Map([
          ['0', Buffer.from('a')],
          ['1', Buffer.from('b')],
        ]),
      })
    );

    const outcome = settle(useCase.execute({ uploadId: 7, owner: 42 }));
    await vi.advanceTimersByTimeAsync(60_000);
    const { error } = await outcome;

    expect(error).toBeInstanceOf(AnkiConnectTimeoutError);
    expect(container.callsOf('storeMediaFile')).toBe(1);
    expect(container.callsOf('addNote')).toBe(0);
  });

  test('releases the account once a send ended on a timeout, so the next send runs', async () => {
    const container = makeAnkiContainer({ addNote: neverAnswer });
    const { useCase } = buildUseCase(container, buildParsed(manyNotes(3)));

    const first = settle(useCase.execute({ uploadId: 7, owner: 42 }));
    await vi.advanceTimersByTimeAsync(60_000);
    await first;
    container.handlers.addNote = answer(9_876_543_210);

    await expect(
      useCase.execute({ uploadId: 7, owner: 42 })
    ).resolves.toMatchObject({ created: 3, errors: [] });
  });

  test('keeps going after Anki rejects a note and reports the partial result', async () => {
    let addNoteCalls = 0;
    const container = makeAnkiContainer({
      addNote: async () => {
        addNoteCalls += 1;
        return addNoteCalls === 1
          ? { result: null, error: 'cannot create note because it is empty' }
          : { result: 9_876_543_210, error: null };
      },
    });
    const { useCase } = buildUseCase(container, buildParsed(manyNotes(3)));

    const result = await useCase.execute({ uploadId: 7, owner: 42 });

    expect(result.created).toBe(2);
    expect(result.errors).toEqual([
      'Note 1000: cannot create note because it is empty',
    ]);
    expect(container.callsOf('sync')).toBe(1);
  });

  test('ends a send that is still answering once it passes the send deadline', async () => {
    const perNoteMs = 5_000;
    const noteCount = Math.ceil(SEND_DEADLINE_MS / perNoteMs) + 20;
    const container = makeAnkiContainer({
      addNote: answerAfter(perNoteMs, 9_876_543_210),
    });
    const { useCase } = buildUseCase(
      container,
      buildParsed(manyNotes(noteCount))
    );

    const outcome = settle(useCase.execute({ uploadId: 7, owner: 42 }));
    await vi.advanceTimersByTimeAsync(noteCount * perNoteMs + 120_000);
    const { error } = await outcome;

    expect(error).toBeInstanceOf(SendDeadlineExceededError);
    expect(error).toBeInstanceOf(AnkiConnectUnreachableError);
    expect(container.callsOf('addNote')).toBeLessThan(noteCount);
    expect(container.callsOf('sync')).toBe(0);
  });

  test('releases the account once a send passed its deadline', async () => {
    const perNoteMs = 5_000;
    const noteCount = Math.ceil(SEND_DEADLINE_MS / perNoteMs) + 20;
    const container = makeAnkiContainer({
      addNote: answerAfter(perNoteMs, 9_876_543_210),
    });
    const { useCase } = buildUseCase(
      container,
      buildParsed(manyNotes(noteCount))
    );

    const first = settle(useCase.execute({ uploadId: 7, owner: 42 }));
    await vi.advanceTimersByTimeAsync(noteCount * perNoteMs + 120_000);
    await first;
    container.handlers.addNote = answer(9_876_543_210);

    await expect(
      useCase.execute({ uploadId: 7, owner: 42 })
    ).resolves.toMatchObject({ created: noteCount });
  });
});
