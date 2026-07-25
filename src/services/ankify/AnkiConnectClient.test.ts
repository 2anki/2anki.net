import {
  ANKI_CONNECT_SYNC_TIMEOUT_MS,
  AnkiConnectClient,
  AnkiConnectError,
  AnkiConnectTimeoutError,
  AnkiConnectUnreachableError,
  AnkiFullSyncRequiredError,
} from './AnkiConnectClient';

const makeFetch = (
  body: unknown,
  init: Partial<{ ok: boolean; status: number; statusText: string }> = {}
) =>
  jest.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => body,
  })) as unknown as typeof fetch;

describe('AnkiConnectClient', () => {
  test('addNote sends a POST with action+version and returns the result', async () => {
    const fetchImpl = makeFetch({ result: 1234567890, error: null });
    const client = new AnkiConnectClient(
      'http://localhost:8765',
      fetchImpl,
      5000
    );

    const id = await client.addNote({
      deckName: 'My Deck',
      modelName: 'TestModel',
      fields: { Front: 'q', Back: 'a' },
      tags: ['notion-sync'],
    });

    expect(id).toBe(1234567890);
    const callArgs = (fetchImpl as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toBe('http://localhost:8765');
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({
      action: 'addNote',
      version: 6,
      params: {
        note: {
          deckName: 'My Deck',
          modelName: 'TestModel',
          fields: { Front: 'q', Back: 'a' },
          tags: ['notion-sync'],
        },
      },
    });
  });

  test('changeDeck sends the card ids and target deck', async () => {
    const fetchImpl = makeFetch({ result: null, error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    await client.changeDeck([9001, 9002], 'MS3::Pharmacology');

    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'changeDeck',
      version: 6,
      params: { cards: [9001, 9002], deck: 'MS3::Pharmacology' },
    });
  });

  test('omits params for parameterless actions like version/sync', async () => {
    const fetchImpl = makeFetch({ result: 6, error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    await client.ping();

    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({ action: 'version', version: 6 });
  });

  test('throws AnkiConnectError when the response carries an error string', async () => {
    const fetchImpl = makeFetch({ result: null, error: 'deck not found' });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    await expect(client.deckNames()).rejects.toBeInstanceOf(AnkiConnectError);
  });

  test('throws AnkiConnectError when HTTP status is not OK', async () => {
    const fetchImpl = makeFetch(
      {},
      { ok: false, status: 500, statusText: 'Internal Server Error' }
    );
    const client = new AnkiConnectClient('http://x', fetchImpl);

    await expect(client.deckNames()).rejects.toBeInstanceOf(AnkiConnectError);
  });

  test('includes the apiKey field in every action body when configured', async () => {
    const fetchImpl = makeFetch({ result: 6, error: null });
    const client = new AnkiConnectClient(
      'http://localhost:8765',
      fetchImpl,
      undefined,
      'secret-key-abc'
    );

    await client.ping();
    await client.deckNames();

    const body0 = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    const body1 = JSON.parse((fetchImpl as jest.Mock).mock.calls[1][1].body);
    expect(body0).toEqual({
      action: 'version',
      version: 6,
      key: 'secret-key-abc',
    });
    expect(body1).toEqual({
      action: 'deckNames',
      version: 6,
      key: 'secret-key-abc',
    });
  });

  test('omits the key field when apiKey is null (legacy/local containers)', async () => {
    const fetchImpl = makeFetch({ result: 6, error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    await client.ping();

    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).not.toHaveProperty('key');
  });

  test('createModel posts the createModel action with css/cardTemplates payload', async () => {
    const fetchImpl = makeFetch({
      result: { id: 1700000000000 },
      error: null,
    });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    await client.createModel({
      modelName: 'Ankify Basic',
      inOrderFields: ['Front', 'Back'],
      css: '.card { color: black; }',
      isCloze: false,
      cardTemplates: [
        {
          Name: 'Card 1',
          Front: '{{Front}}',
          Back: '{{FrontSide}}<hr id="answer">{{Back}}',
        },
      ],
    });

    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'createModel',
      version: 6,
      params: {
        modelName: 'Ankify Basic',
        inOrderFields: ['Front', 'Back'],
        css: '.card { color: black; }',
        isCloze: false,
        cardTemplates: [
          {
            Name: 'Card 1',
            Front: '{{Front}}',
            Back: '{{FrontSide}}<hr id="answer">{{Back}}',
          },
        ],
      },
    });
  });

  test('updateModelStyling posts the updateModelStyling action with model.css payload', async () => {
    const fetchImpl = makeFetch({ result: null, error: null });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    await client.updateModelStyling({
      name: 'Ankify Basic',
      css: '.card { color: red; }',
    });

    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'updateModelStyling',
      version: 6,
      params: {
        model: { name: 'Ankify Basic', css: '.card { color: red; }' },
      },
    });
  });

  test('updateModelTemplates posts the updateModelTemplates action with templates payload', async () => {
    const fetchImpl = makeFetch({ result: null, error: null });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    await client.updateModelTemplates({
      name: 'Ankify Basic',
      templates: {
        'Card 1': { Front: '{{Front}}', Back: '{{Back}}' },
      },
    });

    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'updateModelTemplates',
      version: 6,
      params: {
        model: {
          name: 'Ankify Basic',
          templates: {
            'Card 1': { Front: '{{Front}}', Back: '{{Back}}' },
          },
        },
      },
    });
  });

  test('storeMediaFile posts the storeMediaFile action with filename + base64 data', async () => {
    const fetchImpl = makeFetch({ result: 'ankify-x.png', error: null });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const stored = await client.storeMediaFile({
      filename: 'ankify-x.png',
      data: 'UEFTREFUQQ==',
    });

    expect(stored).toBe('ankify-x.png');
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'storeMediaFile',
      version: 6,
      params: { filename: 'ankify-x.png', data: 'UEFTREFUQQ==' },
    });
  });

  test('getMediaFilesNames posts the action with the pattern and returns the names', async () => {
    const fetchImpl = makeFetch({
      result: ['ankify-a.png', 'ankify-b.jpg'],
      error: null,
    });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const names = await client.getMediaFilesNames('ankify-*');

    expect(names).toEqual(['ankify-a.png', 'ankify-b.jpg']);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'getMediaFilesNames',
      version: 6,
      params: { pattern: 'ankify-*' },
    });
  });

  test('answerCards posts the answerCards action with the answers param', async () => {
    const fetchImpl = makeFetch({ result: [true, true], error: null });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const result = await client.answerCards([
      { cardId: 9001, ease: 3 },
      { cardId: 9002, ease: 1 },
    ]);

    expect(result).toEqual([true, true]);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'answerCards',
      version: 6,
      params: {
        answers: [
          { cardId: 9001, ease: 3 },
          { cardId: 9002, ease: 1 },
        ],
      },
    });
  });

  test('getNumCardsReviewedToday posts the action and returns the count', async () => {
    const fetchImpl = makeFetch({ result: 42, error: null });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const count = await client.getNumCardsReviewedToday();

    expect(count).toBe(42);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({ action: 'getNumCardsReviewedToday', version: 6 });
  });

  test('getDeckStats posts the deck names and returns mapped stat rows', async () => {
    const fetchImpl = makeFetch({
      result: {
        '1651445861967': {
          deck_id: 1651445861967,
          name: 'Pharmacology',
          new_count: 5,
          learn_count: 2,
          review_count: 11,
          total_in_deck: 120,
        },
      },
      error: null,
    });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const stats = await client.getDeckStats(['Pharmacology']);

    expect(stats).toEqual({
      '1651445861967': {
        deck_id: 1651445861967,
        name: 'Pharmacology',
        new_count: 5,
        learn_count: 2,
        review_count: 11,
        total_in_deck: 120,
      },
    });
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'getDeckStats',
      version: 6,
      params: { decks: ['Pharmacology'] },
    });
  });

  test('deckNamesAndIds posts the action and returns the full-name to id map', async () => {
    const fetchImpl = makeFetch({
      result: {
        Default: 1,
        "Jlab's beginner course": 1651445861967,
        "Jlab's beginner course::Part 1: Listening comprehension": 1651445861999,
      },
      error: null,
    });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const map = await client.deckNamesAndIds();

    expect(map).toEqual({
      Default: 1,
      "Jlab's beginner course": 1651445861967,
      "Jlab's beginner course::Part 1: Listening comprehension": 1651445861999,
    });
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'deckNamesAndIds',
      version: 6,
      params: {},
    });
  });

  test('guiBrowse posts the query and returns the matched card ids', async () => {
    const fetchImpl = makeFetch({ result: [1502298033753], error: null });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const cardIds = await client.guiBrowse('nid:1502298033753');

    expect(cardIds).toEqual([1502298033753]);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'guiBrowse',
      version: 6,
      params: { query: 'nid:1502298033753' },
    });
  });

  test('apiReflect posts the scopes+actions payload and returns the action names', async () => {
    const fetchImpl = makeFetch({
      result: { scopes: ['actions'], actions: ['notesModTime', 'multi'] },
      error: null,
    });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const actions = await client.apiReflect();

    expect(actions).toEqual(['notesModTime', 'multi']);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'apiReflect',
      version: 6,
      params: { scopes: ['actions'], actions: null },
    });
  });

  test('apiReflect returns an empty list when the result lacks an actions array', async () => {
    const fetchImpl = makeFetch({
      result: { scopes: ['actions'] },
      error: null,
    });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const actions = await client.apiReflect();

    expect(actions).toEqual([]);
  });

  test('notesModTime posts the note ids and returns id+mod pairs', async () => {
    const fetchImpl = makeFetch({
      result: [
        { noteId: 900, mod: 1700000000 },
        { noteId: 0, mod: 1700000005 },
      ],
      error: null,
    });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const modTimes = await client.notesModTime([900, 0]);

    expect(modTimes).toEqual([
      { noteId: 900, mod: 1700000000 },
      { noteId: 0, mod: 1700000005 },
    ]);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'notesModTime',
      version: 6,
      params: { notes: [900, 0] },
    });
  });

  test('multi posts the wrapped actions array and returns per-action results in order', async () => {
    const fetchImpl = makeFetch({
      result: [
        { result: 111, error: null },
        { result: null, error: 'cannot create note because it is a duplicate' },
      ],
      error: null,
    });
    const client = new AnkiConnectClient('http://localhost:8765', fetchImpl);

    const results = await client.multi([
      { action: 'addNote', params: { note: { deckName: 'D' } } },
      { action: 'addNote', params: { note: { deckName: 'E' } } },
    ]);

    expect(results).toEqual([
      { result: 111, error: null },
      { result: null, error: 'cannot create note because it is a duplicate' },
    ]);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'multi',
      version: 6,
      params: {
        actions: [
          { action: 'addNote', params: { note: { deckName: 'D' } } },
          { action: 'addNote', params: { note: { deckName: 'E' } } },
        ],
      },
    });
  });

  test('retrieveMediaFile posts the filename and returns the base64 string', async () => {
    const fetchImpl = makeFetch({ result: 'UEFTREFUQQ==', error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const data = await client.retrieveMediaFile('foo.jpg');

    expect(data).toBe('UEFTREFUQQ==');
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'retrieveMediaFile',
      version: 6,
      params: { filename: 'foo.jpg' },
    });
  });

  test('retrieveMediaFile returns false when the file is missing', async () => {
    const fetchImpl = makeFetch({ result: false, error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    expect(await client.retrieveMediaFile('missing.png')).toBe(false);
  });

  test('throws AnkiConnectUnreachableError when fetch rejects', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = new AnkiConnectClient('http://x', fetchImpl);

    await expect(client.deckNames()).rejects.toBeInstanceOf(
      AnkiConnectUnreachableError
    );
  });

  test('throws AnkiConnectUnreachableError when the body read fails mid-stream', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new TypeError('fetch failed');
      },
    })) as unknown as typeof fetch;
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const err = await client.findNotes('deck:"X"').catch((e) => e);

    expect(err).toBeInstanceOf(AnkiConnectUnreachableError);
    expect(err).not.toBeInstanceOf(AnkiConnectError);
  });

  const makeHangingFetch = () =>
    jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        })
    ) as unknown as typeof fetch;

  test('throws AnkiConnectTimeoutError (a subclass of unreachable) when a call exceeds its deadline', async () => {
    const fetchImpl = makeHangingFetch();
    const client = new AnkiConnectClient('http://x', fetchImpl, 5);

    const err = await client.deckNames().catch((e) => e);

    expect(err).toBeInstanceOf(AnkiConnectTimeoutError);
    // Existing offline-skip paths catch the parent class — keep that working.
    expect(err).toBeInstanceOf(AnkiConnectUnreachableError);
    expect(err.action).toBe('deckNames');
    expect(err.timeoutMs).toBe(5);
    expect(err.message).toContain('timed out');
  });

  test('sync aborts on the longer sync timeout, not the per-call default', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = makeHangingFetch();
      const client = new AnkiConnectClient('http://x', fetchImpl);

      const pending = client.sync().catch((e) => e);
      await jest.advanceTimersByTimeAsync(ANKI_CONNECT_SYNC_TIMEOUT_MS);
      const err = await pending;

      expect(err).toBeInstanceOf(AnkiConnectTimeoutError);
      expect(err.action).toBe('sync');
      expect(err.timeoutMs).toBe(ANKI_CONNECT_SYNC_TIMEOUT_MS);
    } finally {
      jest.useRealTimers();
    }
  });

  test('sync throws AnkiFullSyncRequiredError when AnkiConnect reports ChangesRequired=FULL_SYNC', async () => {
    const fetchImpl = makeFetch({
      result: null,
      error:
        'Sync status 2 not one of [0, 1] - see SyncCollectionResponse.ChangesRequired for list of sync statuses: https://github.com/ankitects/anki/blob/e41c4573d789afe8b020fab5d9d1eede50c3fa3d/proto/anki/sync.proto#L57-L65',
    });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const err = await client.sync().catch((e) => e);

    expect(err).toBeInstanceOf(AnkiFullSyncRequiredError);
    // Existing generic-error handling should still recognize it.
    expect(err).toBeInstanceOf(AnkiConnectError);
  });

  test('sync rethrows an unrelated AnkiConnectError unchanged', async () => {
    const fetchImpl = makeFetch({ result: null, error: 'deck not found' });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const err = await client.sync().catch((e) => e);

    expect(err).toBeInstanceOf(AnkiConnectError);
    expect(err).not.toBeInstanceOf(AnkiFullSyncRequiredError);
    expect(err.message).toBe('deck not found');
  });

  test('getActiveProfile posts getActiveProfile and returns the profile name', async () => {
    const fetchImpl = makeFetch({ result: 'User 1', error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const profile = await client.getActiveProfile();

    expect(profile).toBe('User 1');
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({ action: 'getActiveProfile', version: 6 });
  });

  test('guiDeckOverview posts the deck name and returns the boolean', async () => {
    const fetchImpl = makeFetch({ result: true, error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const opened = await client.guiDeckOverview('Notion Sync::Pharmacology');

    expect(opened).toBe(true);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'guiDeckOverview',
      version: 6,
      params: { name: 'Notion Sync::Pharmacology' },
    });
  });

  test('getEaseFactors posts the card ids and returns the factors', async () => {
    const fetchImpl = makeFetch({ result: [2500, 1800], error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const factors = await client.getEaseFactors([101, 102]);

    expect(factors).toEqual([2500, 1800]);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'getEaseFactors',
      version: 6,
      params: { cards: [101, 102] },
    });
  });

  test('getIntervals defaults complete to false and returns the intervals', async () => {
    const fetchImpl = makeFetch({ result: [21, 4], error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const intervals = await client.getIntervals([101, 102]);

    expect(intervals).toEqual([21, 4]);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'getIntervals',
      version: 6,
      params: { cards: [101, 102], complete: false },
    });
  });

  test('findCards posts the query and returns matching card ids', async () => {
    const fetchImpl = makeFetch({ result: [1, 2, 3], error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const cards = await client.findCards('deck:"X" -is:new');

    expect(cards).toEqual([1, 2, 3]);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'findCards',
      version: 6,
      params: { query: 'deck:"X" -is:new' },
    });
  });

  test('deleteNotes posts the note ids', async () => {
    const fetchImpl = makeFetch({ result: null, error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const result = await client.deleteNotes([5001, 5002]);

    expect(result).toBeNull();
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'deleteNotes',
      version: 6,
      params: { notes: [5001, 5002] },
    });
  });

  test('unsuspend posts the card ids and returns the boolean result', async () => {
    const fetchImpl = makeFetch({ result: true, error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const changed = await client.unsuspend([9001, 9002]);

    expect(changed).toBe(true);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'unsuspend',
      version: 6,
      params: { cards: [9001, 9002] },
    });
  });

  test('unsuspend returns false when nothing changed', async () => {
    const fetchImpl = makeFetch({ result: false, error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    expect(await client.unsuspend([9001])).toBe(false);
  });

  test('removeTags posts the note ids and the space-separated tag string', async () => {
    const fetchImpl = makeFetch({ result: null, error: null });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const result = await client.removeTags([7001, 7002], 'leech');

    expect(result).toBeNull();
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'removeTags',
      version: 6,
      params: { notes: [7001, 7002], tags: 'leech' },
    });
  });

  test('cardsInfo posts the card ids and returns deck + lapse + queue per card', async () => {
    const fetchImpl = makeFetch({
      result: [
        {
          cardId: 11,
          note: 7001,
          deckName: 'Notion Sync::Pharmacology',
          lapses: 9,
          queue: -1,
        },
      ],
      error: null,
    });
    const client = new AnkiConnectClient('http://x', fetchImpl);

    const info = await client.cardsInfo([11]);

    expect(info).toEqual([
      {
        cardId: 11,
        note: 7001,
        deckName: 'Notion Sync::Pharmacology',
        lapses: 9,
        queue: -1,
      },
    ]);
    const body = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({
      action: 'cardsInfo',
      version: 6,
      params: { cards: [11] },
    });
  });
});
