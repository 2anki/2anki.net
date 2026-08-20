import {
  NoActiveAnkifyClientError,
  ParsedApkgForSend,
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
    createDeck: jest.fn(async (_d: string) => 1),
    addNote: jest.fn(async (_n: unknown) => 9_876_543_210),
    updateNoteFields: jest.fn(async (_id: number, _f: unknown) => null),
    sync: jest.fn(async () => null),
    modelNames: jest.fn(async () => [] as string[]),
    createModel: jest.fn(async (_p: unknown) => ({ id: 1 })),
    storeMediaFile: jest.fn(async (_p: unknown) => 'ok'),
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
  clients: jest.Mocked<AnkifyClientsRepositoryInterface>;
  mappings: jest.Mocked<AnkifySyncMappingsRepositoryInterface>;
  uploads: jest.Mocked<IUploadRepository>;
} => ({
  clients: {
    create: jest.fn(),
    listByOwner: jest.fn(),
    findActiveById: jest.fn(),
    findActiveByOwner: jest.fn(async () =>
      'activeClient' in overrides ? overrides.activeClient! : sampleClient()
    ),
    setStatus: jest.fn(),
    touchLastActiveAt: jest.fn(),
    reservedPorts: jest.fn(),
  } as unknown as jest.Mocked<AnkifyClientsRepositoryInterface>,
  mappings: {
    findBySourceId: jest.fn(async () => (await overrides.findMapping) ?? null),
    upsert: jest.fn(async (input) => ({
      id: 1,
      ankify_client_id: input.ankify_client_id,
      source_id: input.source_id,
      source_type: input.source_type,
      anki_note_id: input.anki_note_id,
      deck_name: input.deck_name,
      content_hash: input.content_hash ?? null,
      last_synced_at: new Date(),
    })),
    listByClient: jest.fn(),
    findByAnkiNoteId: jest.fn(),
    deleteByAnkiNoteId: jest.fn(),
  } as unknown as jest.Mocked<AnkifySyncMappingsRepositoryInterface>,
  uploads: {
    deleteUpload: jest.fn(),
    getUploadsByOwner: jest.fn(),
    findByIdAndOwner: jest.fn(
      async () =>
        (overrides.upload === undefined
          ? sampleUpload()
          : overrides.upload) as never
    ),
    update: jest.fn(),
  } as unknown as jest.Mocked<IUploadRepository>,
});

describe('SendUploadToRacUseCase', () => {
  test('addNote path: creates deck, dispatches new notes, persists mappings', async () => {
    const { clients, mappings, uploads } = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => Buffer.from('fake'),
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
    (ac.sync as jest.Mock).mockRejectedValueOnce(
      new Error('AnkiWeb account not configured')
    );
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => Buffer.from('fake'),
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
      async () => Buffer.from('fake'),
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
      async () => Buffer.from('fake'),
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
    (ac.updateNoteFields as jest.Mock).mockRejectedValueOnce(
      new AnkiConnectError('Note was not found: 555')
    );
    (ac.addNote as jest.Mock).mockResolvedValueOnce(7777);

    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => Buffer.from('fake'),
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
      async () => Buffer.from('fake'),
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
      async () => Buffer.from('fake'),
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
    const created = (ac.createModel as jest.Mock).mock.calls.map(
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
      async () => Buffer.from(''),
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
      async () => Buffer.from(''),
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
    (ac.addNote as jest.Mock)
      .mockRejectedValueOnce(new AnkiConnectError('first failed'))
      .mockResolvedValueOnce(2);
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => Buffer.from('fake'),
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
    (ac.storeMediaFile as jest.Mock).mockImplementation(async (params) => {
      callOrder.push(`store:${(params as { filename: string }).filename}`);
      return 'ok';
    });
    (ac.addNote as jest.Mock).mockImplementation(async () => {
      callOrder.push('addNote');
      return 9_876_543_210;
    });

    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => Buffer.from('fake'),
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
    (ac.storeMediaFile as jest.Mock)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce('ok');

    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => Buffer.from('fake'),
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
      async () => Buffer.from('fake'),
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
    (ac.addNote as jest.Mock)
      .mockResolvedValueOnce(9_876_543_210)
      .mockRejectedValueOnce(new AnkiConnectError('duplicate note'));
    const logs = { log: jest.fn(async () => undefined), list: jest.fn() };
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
      async () => Buffer.from('fake'),
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
    (ac.addNote as jest.Mock).mockRejectedValue(
      new AnkiConnectError('collection locked')
    );
    const logs = { log: jest.fn(async () => undefined), list: jest.fn() };
    const useCase = new SendUploadToRacUseCase(
      clients,
      mappings,
      uploads,
      async () => Buffer.from('fake'),
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
      async () => Buffer.from('fake'),
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
});
