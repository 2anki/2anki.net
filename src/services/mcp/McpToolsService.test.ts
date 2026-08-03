import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type UsersRepository from '../../data_layer/UsersRepository';
import { McpToolsService, UploadEntrypoint } from './McpToolsService';
import { DeckPersistence } from './McpDeckPersistence';
import { JobWithDownloadKey } from '../../data_layer/JobRepository';
import ApkgPreviewService from '../ApkgPreviewService/ApkgPreviewService';
import DownloadService from '../DownloadService';
import type StorageHandler from '../../lib/storage/StorageHandler';
import {
  PhotoToFlashcardsUseCase,
  type PhotoVisionCards,
} from '../../usecases/imageOcclusion/PhotoToFlashcardsUseCase';

// 1x1 transparent PNG — real bytes so detectFileMime and image-size resolve.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function makeService(overrides: {
  jobs?: JobWithDownloadKey[];
  uploadEntry?: UploadEntrypoint;
  getFileBody?: DownloadService['getFileBody'];
  preview?: Partial<ApkgPreviewService>;
  persist?: DeckPersistence['persist'];
  getPresignedUrl?: StorageHandler['getPresignedUrl'];
  generateCards?: jest.Mock;
  getCardUsage?: jest.Mock;
  incrementCardUsage?: jest.Mock;
  baseUrl?: string;
}) {
  const jobLister = {
    getJobsByOwner: jest.fn(async () => overrides.jobs ?? []),
  };
  const downloadService = {
    getFileBody: overrides.getFileBody ?? jest.fn(async () => null),
  } as unknown as DownloadService;
  const previewService = {
    parse: jest.fn(async () => ({}) as never),
    getMeta: jest.fn(() => ({
      totalCards: 3,
      decks: [{ id: 1, fullName: 'Bio', path: ['Bio'], cardCount: 3 }],
    })),
    getCardsPage: jest.fn(() => ({
      cards: [{ front: 'Q', back: 'A' }],
      nextCursor: null,
      total: 3,
    })),
    ...overrides.preview,
  } as unknown as ApkgPreviewService;
  const uploadEntry =
    overrides.uploadEntry ??
    ((_req: express.Request, res: express.Response) => {
      res.status(200);
    });
  const persist = jest.fn(
    overrides.persist ?? (async () => 'owner-9-123-deck.apkg')
  );
  const deckPersistence = { persist } as unknown as DeckPersistence;
  const getPresignedUrl = jest.fn(
    overrides.getPresignedUrl ?? (async () => 'https://s3.example/presigned')
  );
  const storage = { getPresignedUrl } as unknown as StorageHandler;
  const generateCards = overrides.generateCards ?? jest.fn();
  const photoToFlashcards = {
    generateCards,
  } as unknown as PhotoToFlashcardsUseCase;
  const getCardUsage =
    overrides.getCardUsage ?? jest.fn(async () => ({ cards_used: 0 }));
  const incrementCardUsage = overrides.incrementCardUsage ?? jest.fn();
  const usersRepository = {
    getCardUsage,
    incrementCardUsage,
  } as unknown as UsersRepository;
  const service = new McpToolsService(
    jobLister,
    downloadService,
    previewService,
    uploadEntry,
    storage,
    deckPersistence,
    photoToFlashcards,
    usersRepository,
    overrides.baseUrl ?? 'https://mcp.test'
  );
  return {
    service,
    jobLister,
    downloadService,
    persist,
    getPresignedUrl,
    generateCards,
    getCardUsage,
    incrementCardUsage,
    previewService,
  };
}

type SampleInput = { front: string; back: string; ord: number };

function reversibleNoteTypes() {
  return new Map([
    [
      1,
      {
        id: 1,
        name: 'Basic (and reversed card)',
        type: 0,
        css: '',
        fields: [],
        templates: [
          { name: 'Card 1', ord: 0, qfmt: '', afmt: '' },
          { name: 'Card 2', ord: 1, qfmt: '', afmt: '' },
        ],
      },
    ],
  ]);
}

function basicNoteTypes() {
  return new Map([
    [
      1,
      {
        id: 1,
        name: 'Basic',
        type: 0,
        css: '',
        fields: [],
        templates: [{ name: 'Card 1', ord: 0, qfmt: '', afmt: '' }],
      },
    ],
  ]);
}

function makePreview(
  noteTypes: unknown,
  cards: SampleInput[]
): Partial<ApkgPreviewService> {
  const parsed = {
    collection: {
      noteTypes,
      cards: cards.map((card, index) => ({
        id: index + 1,
        nid: index + 1,
        did: 1,
        ord: card.ord,
      })),
      notes: new Map(),
      decks: new Map(),
    },
  };
  return {
    parse: jest.fn(async () => parsed as never),
    getMeta: jest.fn(() => ({ totalCards: cards.length, decks: [] })),
    getCardsPage: jest.fn(
      () => ({ cards, nextCursor: null, total: cards.length }) as never
    ),
  };
}

function reversiblePreview(cards: SampleInput[]): Partial<ApkgPreviewService> {
  return makePreview(reversibleNoteTypes(), cards);
}

function basicPreview(cards: SampleInput[]): Partial<ApkgPreviewService> {
  return makePreview(basicNoteTypes(), cards);
}

describe('McpToolsService.listMyDecks', () => {
  it('maps jobs to owner-scoped summaries with download URLs', async () => {
    const { service } = makeService({
      jobs: [
        {
          object_id: 'job-1',
          title: 'Pharmacology',
          status: 'done',
          created_at: new Date('2026-07-18T00:00:00.000Z'),
          download_key: 'k1',
        } as unknown as JobWithDownloadKey,
        {
          object_id: 'job-2',
          title: null,
          status: 'processing',
          created_at: null,
          download_key: null,
        } as unknown as JobWithDownloadKey,
      ],
    });
    const { decks, total } = await service.listMyDecks('owner-9');
    expect(total).toBe(2);
    expect(decks[0]).toEqual({
      jobId: 'job-1',
      title: 'Pharmacology',
      status: 'done',
      createdAt: '2026-07-18T00:00:00.000Z',
      downloadUrl: 'https://mcp.test/api/upload/jobs/job-1/download',
    });
    expect(decks[1].title).toBe('Untitled deck');
    expect(decks[1].downloadUrl).toBeNull();
  });

  it('caps the list at the limit and notes how to fetch more', async () => {
    const jobs = Array.from({ length: 5 }, (_, i) => ({
      object_id: `job-${i}`,
      title: `Deck ${i}`,
      status: 'done',
      created_at: null,
      download_key: null,
    })) as unknown as JobWithDownloadKey[];
    const { service } = makeService({ jobs });
    const result = await service.listMyDecks('owner-9', 2);
    expect(result.decks).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.note).toContain('Showing 2 of 5 decks');
  });
});

describe('McpToolsService.getDeckPreview', () => {
  const jobFixture = (
    overrides: Partial<JobWithDownloadKey>
  ): JobWithDownloadKey =>
    ({
      object_id: 'job-1',
      title: 'Bio',
      status: 'done',
      created_at: null,
      download_key: 'deck.apkg',
      ...overrides,
    }) as unknown as JobWithDownloadKey;

  it('rejects an unknown jobId as not found', async () => {
    const { service, downloadService } = makeService({
      jobs: [jobFixture({ object_id: 'job-1' })],
    });
    await expect(service.getDeckPreview('owner', 'nope')).rejects.toThrow(
      /Deck not found/
    );
    expect(downloadService.getFileBody).not.toHaveBeenCalled();
  });

  it('rejects a job with no .apkg without hitting storage', async () => {
    const { service, downloadService } = makeService({
      jobs: [jobFixture({ object_id: 'job-1', download_key: null })],
    });
    await expect(service.getDeckPreview('owner', 'job-1')).rejects.toThrow(
      /no .apkg/
    );
    expect(downloadService.getFileBody).not.toHaveBeenCalled();
  });

  it('resolves the jobId to its download_key and returns meta + sample cards', async () => {
    const getFileBody = jest.fn(async () => Buffer.from('apkg'));
    const { service } = makeService({
      jobs: [jobFixture({ object_id: 'job-1', download_key: 'deck.apkg' })],
      getFileBody,
    });
    const preview = await service.getDeckPreview('owner', 'job-1');
    expect(getFileBody).toHaveBeenCalledWith(
      'owner',
      'deck.apkg',
      expect.anything()
    );
    expect(preview.cardCount).toBe(3);
    expect(preview.decks).toEqual([{ id: 1, name: 'Bio', cardCount: 3 }]);
    expect(preview.sampleCards).toEqual([{ front: 'Q', back: 'A' }]);
  });

  it('resolves a raw .apkg key directly when no job matches, owner-scoped', async () => {
    const getFileBody = jest.fn(async () => Buffer.from('apkg'));
    const { service } = makeService({
      jobs: [jobFixture({ object_id: 'job-1' })],
      getFileBody,
    });
    const preview = await service.getDeckPreview('owner', 'legacy-deck.apkg');
    expect(getFileBody).toHaveBeenCalledWith(
      'owner',
      'legacy-deck.apkg',
      expect.anything()
    );
    expect(preview.cardCount).toBe(3);
  });

  it('rejects an unknown identifier that is not an .apkg key', async () => {
    const { service, downloadService } = makeService({
      jobs: [jobFixture({ object_id: 'job-1' })],
    });
    await expect(service.getDeckPreview('owner', 'not-a-key')).rejects.toThrow(
      /Deck not found/
    );
    expect(downloadService.getFileBody).not.toHaveBeenCalled();
  });

  it('reports when the resolved file is missing from storage', async () => {
    const { service } = makeService({
      jobs: [jobFixture({ object_id: 'job-1', download_key: 'deck.apkg' })],
      getFileBody: jest.fn(async () => null),
    });
    await expect(service.getDeckPreview('owner', 'job-1')).rejects.toThrow(
      /Upload not found/
    );
  });
});

describe('McpToolsService.convertToDeck', () => {
  it('maps a 202 async response to a processing result with the job id', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.status(202).json({ jobId: 'job-async' });
    };
    const { service, persist } = makeService({ uploadEntry });
    const result = await service.convertToDeck({ text: '# hi' }, 'owner', {
      owner: 'o',
    });
    expect(result).toMatchObject({ kind: 'processing', jobId: 'job-async' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('maps a batch response to download URLs', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.status(200).json({
        kind: 'batch',
        decks: [
          { name: 'A', filename: 'A.apkg', downloadUrl: '/download/w/A.apkg' },
        ],
      });
    };
    const { service } = makeService({ uploadEntry });
    const result = await service.convertToDeck({ text: 'x' }, 'owner', {});
    expect(result).toEqual({
      kind: 'batch',
      deckCount: 1,
      decks: [{ name: 'A', downloadUrl: '/download/w/A.apkg' }],
      summary: '1 decks ready to download.',
    });
  });

  it('persists a single-deck byte response and returns a jobId + presigned download URL', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.set('X-Card-Count', '42');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service, persist } = makeService({ uploadEntry });
    const result = await service.convertToDeck({ text: 'x' }, 'owner-9', {});
    const jobId = (result as { jobId?: string }).jobId;
    expect(result).toMatchObject({
      kind: 'deck',
      cardCount: 42,
      filename: 'deck.apkg',
      downloadUrl: `https://mcp.test/api/mcp/decks/${jobId}/download`,
      deckCount: 1,
      decks: [{ id: 1, name: 'Bio', cardCount: 3 }],
      sampleCards: [{ front: 'Q', back: 'A' }],
    });
    expect(jobId).toEqual(expect.any(String));
    expect(persist).toHaveBeenCalledWith(
      'owner-9',
      expect.any(String),
      'deck.apkg',
      Buffer.from('APKG-BYTES')
    );
  });

  it('decodes a percent-encoded File-Name header into a readable filename (regression: #3748)', async () => {
    const japanese = '日本語レッスン：まるごと１・旅行ロールプレイ.apkg';
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.set('X-Card-Count', '40');
      res.set('File-Name', encodeURIComponent(japanese));
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service, persist } = makeService({ uploadEntry });
    const result = await service.convertToDeck({ text: 'x' }, 'owner-9', {});
    expect(result).toMatchObject({ kind: 'deck', filename: japanese });
    expect(persist).toHaveBeenCalledWith(
      'owner-9',
      expect.any(String),
      japanese,
      Buffer.from('APKG-BYTES')
    );
  });

  it('still returns the deck when inline preview parsing fails', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.set('X-Card-Count', '7');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('CORRUPT'));
    };
    const { service } = makeService({
      uploadEntry,
      preview: {
        parse: jest.fn(async () => {
          throw new Error('bad apkg');
        }),
      },
    });
    const result = await service.convertToDeck({ text: 'x' }, 'owner', {});
    expect(result).toMatchObject({ kind: 'deck', cardCount: 7 });
    expect((result as { decks?: unknown }).decks).toBeUndefined();
  });

  it('threads curated options into the upload request body', async () => {
    let capturedBody: Record<string, string> | undefined;
    const uploadEntry: UploadEntrypoint = (req, res) => {
      capturedBody = (req as unknown as { body: Record<string, string> }).body;
      res.status(202).json({ jobId: 'job-async' });
    };
    const { service } = makeService({ uploadEntry });
    await service.convertToDeck(
      {
        text: '# hi',
        options: {
          noteType: 'cloze',
          tags: ['bio'],
          deckName: 'Bio',
          styleTemplate: 'nostyle',
        },
      },
      'owner',
      {}
    );
    expect(capturedBody).toEqual({
      cloze: 'true',
      'global-tags': 'bio',
      deckName: 'Bio',
      template: 'nostyle',
    });
  });

  // The whole point of the CSV-via-text path: an assistant holding an uploaded
  // spreadsheet pastes its contents into text and names it, and the extension
  // has to survive getSafeFilename so FallbackParser dispatches on .csv.
  it('keeps the csv extension when text is named with a filename', async () => {
    let capturedFiles: { originalname: string; buffer: Buffer }[] | undefined;
    const uploadEntry: UploadEntrypoint = (req, res) => {
      capturedFiles = (
        req as unknown as { files: { originalname: string; buffer: Buffer }[] }
      ).files;
      res.status(202).json({ jobId: 'job-async' });
    };
    const { service } = makeService({ uploadEntry });
    await service.convertToDeck(
      { text: 'front,back\n水,water', filename: 'n5.csv' },
      'owner',
      {}
    );
    expect(capturedFiles).toHaveLength(1);
    expect(capturedFiles?.[0].originalname).toBe('n5.csv');
    expect(capturedFiles?.[0].buffer.toString('utf-8')).toBe(
      'front,back\n水,water'
    );
  });

  it('sends an empty body when no options are given', async () => {
    let capturedBody: Record<string, string> | undefined;
    const uploadEntry: UploadEntrypoint = (req, res) => {
      capturedBody = (req as unknown as { body: Record<string, string> }).body;
      res.status(202).json({ jobId: 'job-async' });
    };
    const { service } = makeService({ uploadEntry });
    await service.convertToDeck({ text: '# hi' }, 'owner', {});
    expect(capturedBody).toEqual({});
  });

  it('returns an error result when neither url nor text is given', async () => {
    const { service, persist } = makeService({});
    const result = await service.convertToDeck({}, 'owner', {});
    expect(result).toMatchObject({ kind: 'error' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('returns the paywall message when the upload redirects to the card limit', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.redirect('/limit?kind=card_count');
    };
    const { service, persist } = makeService({ uploadEntry });
    const result = await service.convertToDeck({ text: 'x' }, 'owner', {});
    expect(result).toEqual({
      kind: 'error',
      code: 'monthly_limit',
      message:
        "You've reached your free limit of 100 cards this month, so this deck wasn't created. Upgrade to Unlimited to keep converting, or wait for your limit to reset next month. Upgrade: https://2anki.net/pricing?from=mcp",
    });
    expect((result as { message: string }).message).toContain(
      'https://2anki.net/pricing?from=mcp'
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('surfaces the upload error message on a 400', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.status(400).json({ message: 'This file type is not supported.' });
    };
    const { service, persist } = makeService({ uploadEntry });
    const result = await service.convertToDeck({ text: 'x' }, 'owner', {});
    expect(result).toEqual({
      kind: 'error',
      message: 'This file type is not supported.',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('remaps markdown_likely_lossy to the context-neutral no-cards guidance', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.status(400).json({
        code: 'markdown_likely_lossy',
        message: 'Notion-flavored lossy reason',
      });
    };
    const { service } = makeService({ uploadEntry });
    const result = await service.convertToDeck(
      { text: 'a table' },
      'owner',
      {}
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: 'markdown_likely_lossy',
    });
    const message = (result as { message: string }).message;
    expect(message).toContain('No cards found in this text');
    expect(message).toContain('create_deck');
    expect(message).toContain('deck_capabilities');
    expect(message).not.toContain('Notion-flavored lossy reason');
  });

  it('remaps empty_export to the same no-cards guidance', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.status(400).json({ code: 'empty_export', message: 'No cards.' });
    };
    const { service } = makeService({ uploadEntry });
    const result = await service.convertToDeck({ text: 'x' }, 'owner', {});
    expect(result).toMatchObject({ kind: 'error', code: 'empty_export' });
    expect((result as { message: string }).message).toContain(
      'No cards found in this text'
    );
  });

  it('echoes the applied options back in the public option vocabulary', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.set('X-Card-Count', '3');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service } = makeService({ uploadEntry });
    const result = await service.convertToDeck(
      {
        text: 'Q :: A',
        options: {
          noteType: 'basic-reversed',
          tags: ['bio'],
          deckName: 'Cells',
          styleTemplate: 'nostyle',
        },
      },
      'owner-9',
      {}
    );
    expect(result).toMatchObject({
      kind: 'deck',
      applied: {
        noteType: 'basic-reversed',
        tags: ['bio'],
        deckName: 'Cells',
        styleTemplate: 'nostyle',
        splitByHeadings: false,
        tts: { enabled: false },
      },
    });
    expect((result as { ignored?: unknown }).ignored).toBeUndefined();
  });

  it('downgrades cloze to basic and reports it in ignored when the text has no markup', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.set('X-Card-Count', '1');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service } = makeService({ uploadEntry });
    const result = await service.convertToDeck(
      { text: 'Front :: Back', options: { noteType: 'cloze' } },
      'owner-9',
      {}
    );
    expect(result).toMatchObject({
      kind: 'deck',
      applied: { noteType: 'basic' },
      ignored: [
        {
          option: 'noteType',
          requested: 'cloze',
          reason:
            'No {{c1::}} markup found in the text; built basic cards instead.',
        },
      ],
    });
  });

  it('keeps cloze in applied when the text carries {{c1::}} markup', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.set('X-Card-Count', '1');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service } = makeService({ uploadEntry });
    const result = await service.convertToDeck(
      {
        text: 'The {{c1::mitochondrion}} is the powerhouse :: extra',
        options: { noteType: 'cloze' },
      },
      'owner-9',
      {}
    );
    expect(result).toMatchObject({
      kind: 'deck',
      applied: { noteType: 'cloze' },
    });
    expect((result as { ignored?: unknown }).ignored).toBeUndefined();
  });

  it('labels reversible sample cards with a forward/reverse direction', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.set('X-Card-Count', '2');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service } = makeService({
      uploadEntry,
      preview: reversiblePreview([
        { front: 'F', back: 'B', ord: 0 },
        { front: 'B', back: 'F', ord: 1 },
      ]),
    });
    const result = await service.convertToDeck({ text: 'x' }, 'owner-9', {});
    expect((result as { sampleCards?: unknown }).sampleCards).toEqual([
      { front: 'F', back: 'B', direction: 'forward' },
      { front: 'B', back: 'F', direction: 'reverse' },
    ]);
  });

  it('omits direction on a non-reversible deck', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.set('X-Card-Count', '1');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service } = makeService({
      uploadEntry,
      preview: basicPreview([{ front: 'Q', back: 'A', ord: 0 }]),
    });
    const result = await service.convertToDeck({ text: 'x' }, 'owner-9', {});
    expect((result as { sampleCards?: unknown }).sampleCards).toEqual([
      { front: 'Q', back: 'A' },
    ]);
  });

  it('adds a reverse sample when the first page of a reversible deck is all forward', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.set('X-Card-Count', '2');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const parsed = {
      collection: {
        noteTypes: reversibleNoteTypes(),
        cards: [
          { id: 1, nid: 1, did: 1, ord: 0 },
          { id: 2, nid: 1, did: 1, ord: 1 },
        ],
        notes: new Map(),
        decks: new Map(),
      },
    };
    const getCardsPage = jest.fn((_p: unknown, cursor: number) =>
      cursor === 0
        ? {
            cards: [{ front: 'F', back: 'B', ord: 0 }],
            nextCursor: null,
            total: 2,
          }
        : {
            cards: [{ front: 'B', back: 'F', ord: 1 }],
            nextCursor: null,
            total: 2,
          }
    );
    const { service } = makeService({
      uploadEntry,
      preview: {
        parse: jest.fn(async () => parsed as never),
        getMeta: jest.fn(() => ({ totalCards: 2, decks: [] })),
        getCardsPage,
      } as unknown as Partial<ApkgPreviewService>,
    });
    const result = await service.convertToDeck({ text: 'x' }, 'owner-9', {});
    expect((result as { sampleCards?: unknown }).sampleCards).toEqual([
      { front: 'F', back: 'B', direction: 'forward' },
      { front: 'B', back: 'F', direction: 'reverse' },
    ]);
  });
});

describe('McpToolsService.createDeck', () => {
  const captureUpload = (): {
    entry: UploadEntrypoint;
    markdown: () => string;
  } => {
    let captured = '';
    const entry: UploadEntrypoint = (req, res) => {
      const files = (req as unknown as { files: { buffer: Buffer }[] }).files;
      captured = files[0].buffer.toString('utf-8');
      res.set('X-Card-Count', '2');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    return { entry, markdown: () => captured };
  };

  it('serializes cards to heading markdown, persists, and returns a download URL', async () => {
    const { entry, markdown } = captureUpload();
    const { service, persist } = makeService({
      uploadEntry: entry,
    });
    const result = await service.createDeck(
      [
        { front: 'What is ATP?', back: 'Energy currency.' },
        { front: 'What is DNA?', back: 'Heredity molecule.' },
      ],
      'Biochemistry',
      undefined,
      'owner-9',
      {}
    );
    expect(markdown()).toBe(
      '## What is ATP?\n\nEnergy currency.\n\n' +
        '## What is DNA?\n\nHeredity molecule.\n\n'
    );
    const jobId = (result as { jobId?: string }).jobId;
    expect(result).toMatchObject({
      kind: 'deck',
      cardCount: 2,
      downloadUrl: `https://mcp.test/api/mcp/decks/${jobId}/download`,
    });
    expect(jobId).toEqual(expect.any(String));
    expect(persist).toHaveBeenCalledWith(
      'owner-9',
      expect.any(String),
      'deck.apkg',
      Buffer.from('APKG-BYTES')
    );
  });

  it('keys the preview cache by the jobId, not the deck name, so a reused name does not return stale cards (regression: #3744)', async () => {
    const { entry } = captureUpload();
    const { service, previewService } = makeService({ uploadEntry: entry });
    const parseMock = previewService.parse as jest.Mock;

    const first = await service.createDeck(
      [{ front: 'A-front', back: 'A-back' }],
      'Same Name',
      undefined,
      'owner-9',
      {}
    );
    const second = await service.createDeck(
      [{ front: 'B-front', back: 'B-back' }],
      'Same Name',
      undefined,
      'owner-9',
      {}
    );

    const firstJobId = (first as { jobId?: string }).jobId;
    const secondJobId = (second as { jobId?: string }).jobId;
    expect(firstJobId).not.toBe(secondJobId);
    expect(parseMock).toHaveBeenNthCalledWith(
      1,
      `mcp:${firstJobId}`,
      expect.any(Buffer)
    );
    expect(parseMock).toHaveBeenNthCalledWith(
      2,
      `mcp:${secondJobId}`,
      expect.any(Buffer)
    );
  });

  it('passes the deck name to the pipeline settings so it wins over the first heading', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const entry: UploadEntrypoint = (req, res) => {
      capturedBody = (req as unknown as { body: Record<string, unknown> }).body;
      res.set('X-Card-Count', '1');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service } = makeService({ uploadEntry: entry });
    await service.createDeck(
      [{ front: 'morning', back: '朝' }],
      'Japanese — Greetings',
      undefined,
      'owner-9',
      {}
    );
    expect(capturedBody).toEqual({ deckName: 'Japanese — Greetings' });
  });

  it('falls back to the card count when the pipeline reports none', async () => {
    const entry: UploadEntrypoint = (_req, res) => {
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service } = makeService({ uploadEntry: entry });
    const result = await service.createDeck(
      [
        { front: 'A', back: 'alpha' },
        { front: 'B', back: 'beta' },
        { front: 'C', back: 'gamma' },
      ],
      undefined,
      undefined,
      'owner-9',
      {}
    );
    expect(result).toMatchObject({ kind: 'deck', cardCount: 3 });
  });

  it('names the upload file from the deck name', async () => {
    let uploadedName = '';
    const entry: UploadEntrypoint = (req, res) => {
      const files = (req as unknown as { files: { originalname: string }[] })
        .files;
      uploadedName = files[0].originalname;
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service } = makeService({ uploadEntry: entry });
    await service.createDeck(
      [{ front: 'Q', back: 'A' }],
      'Pharmacology',
      undefined,
      'owner-9',
      {}
    );
    expect(uploadedName).toBe('Pharmacology.md');
  });

  it('rejects an empty cards array without touching persistence', async () => {
    const { service, persist } = makeService({});
    const result = await service.createDeck(
      [],
      'Deck',
      undefined,
      'owner-9',
      {}
    );
    expect(result).toMatchObject({ kind: 'error' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a card with an empty front', async () => {
    const { service, persist } = makeService({});
    const result = await service.createDeck(
      [{ front: '   ', back: 'answer' }],
      'Deck',
      undefined,
      'owner-9',
      {}
    );
    expect(result).toMatchObject({ kind: 'error' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects more than 500 cards', async () => {
    const { service, persist } = makeService({});
    const cards = Array.from({ length: 501 }, (_v, i) => ({
      front: `Q${i}`,
      back: `A${i}`,
    }));
    const result = await service.createDeck(
      cards,
      'Deck',
      undefined,
      'owner-9',
      {}
    );
    expect(result).toMatchObject({ kind: 'error' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('returns the empty-back guidance instead of the convert-flavored message when every back is empty', async () => {
    const uploadEntry: UploadEntrypoint = (_req, res) => {
      res.status(400).json({ code: 'empty_export', message: 'No cards.' });
    };
    const { service } = makeService({ uploadEntry });
    const result = await service.createDeck(
      [
        { front: 'Front only', back: '' },
        { front: 'Another', back: '   ' },
      ],
      'Deck',
      undefined,
      'owner-9',
      {}
    );
    expect(result).toEqual({
      kind: 'error',
      code: 'empty_export',
      message:
        'Some cards have an empty back. Every card needs both a front and a back.',
    });
  });

  it('threads options.noteType through to the pipeline settings and echoes it in applied', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const entry: UploadEntrypoint = (req, res) => {
      capturedBody = (req as unknown as { body: Record<string, unknown> }).body;
      res.set('X-Card-Count', '1');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service } = makeService({ uploadEntry: entry });
    const result = await service.createDeck(
      [{ front: 'Mitochondrion', back: 'Powerhouse of the cell' }],
      'Biology',
      { noteType: 'input', tags: ['bio'] },
      'owner-9',
      {}
    );
    expect(capturedBody).toEqual({
      deckName: 'Biology',
      'enable-input': 'true',
      cloze: 'false',
      'global-tags': 'bio',
    });
    expect(result).toMatchObject({
      kind: 'deck',
      applied: { noteType: 'input', tags: ['bio'] },
    });
    expect((result as { ignored?: unknown }).ignored).toBeUndefined();
  });

  it('reports no ignored entry for input when every card back is short and plain (regression: #3848)', async () => {
    const { entry } = captureUpload();
    const { service } = makeService({ uploadEntry: entry });
    const result = await service.createDeck(
      [{ front: 'schedule', back: '予定' }],
      'Japanese Vocabulary',
      { noteType: 'input' },
      'owner-9',
      {}
    );
    expect(result).toMatchObject({
      kind: 'deck',
      applied: { noteType: 'input' },
    });
    expect((result as { ignored?: unknown }).ignored).toBeUndefined();
  });

  it('keeps noteType input in applied but reports it ignored when a back is too long to type', async () => {
    const { entry } = captureUpload();
    const { service } = makeService({ uploadEntry: entry });
    const result = await service.createDeck(
      [
        { front: 'schedule', back: '予定' },
        {
          front: 'What is mitosis?',
          back: 'Mitosis is the process by which a single eukaryotic cell divides to produce two genetically identical daughter cells.',
        },
      ],
      'Biology',
      { noteType: 'input' },
      'owner-9',
      {}
    );
    expect(result).toMatchObject({
      kind: 'deck',
      applied: { noteType: 'input' },
      ignored: [
        {
          option: 'noteType',
          requested: 'input',
          reason:
            'One or more card backs were too long, multi-line, or contained a link/image to type as an answer; those cards built as basic instead.',
        },
      ],
    });
  });

  it('downgrades cloze to basic and reports it in ignored when no card has {{c1::}} markup', async () => {
    const { entry } = captureUpload();
    const { service } = makeService({ uploadEntry: entry });
    const result = await service.createDeck(
      [{ front: 'Mitochondrion', back: 'Powerhouse of the cell' }],
      'Biology',
      { noteType: 'cloze' },
      'owner-9',
      {}
    );
    expect(result).toMatchObject({
      kind: 'deck',
      applied: { noteType: 'basic' },
      ignored: [
        {
          option: 'noteType',
          requested: 'cloze',
          reason:
            'No {{c1::}} markup found in the text; built basic cards instead.',
        },
      ],
    });
  });

  it('omits applied entirely when no options are given, unchanged from before', async () => {
    const { entry } = captureUpload();
    const { service } = makeService({ uploadEntry: entry });
    const result = await service.createDeck(
      [{ front: 'Q', back: 'A' }],
      'Deck',
      undefined,
      'owner-9',
      {}
    );
    expect((result as { applied?: unknown }).applied).toBeUndefined();
  });
});

describe('McpToolsService.photoToDeck', () => {
  const visionResult = (
    cards: { front: string; back: string }[]
  ): PhotoVisionCards => ({
    decks: [],
    cards,
    cardCount: cards.length,
    deckName: 'Photo deck',
    estimatedCostUsd: 0.01,
    tileCount: 1,
    inputTokens: 100,
    outputTokens: 50,
  });

  it('decodes a data URL, runs vision, and maps the cards to a result', async () => {
    const generateCards = jest.fn(async () =>
      visionResult([
        { front: 'Q1', back: 'A1' },
        { front: 'Q2', back: 'A2' },
      ])
    );
    const { service } = makeService({ generateCards });
    const result = await service.photoToDeck(
      { image: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}` },
      'owner-1',
      { subscriber: true }
    );
    expect(generateCards).toHaveBeenCalledWith(
      expect.objectContaining({
        imageBase64: ONE_PIXEL_PNG_BASE64,
        mediaType: 'image/png',
        owner: 'owner-1',
        isPaying: true,
        imageDimensions: { width: 1, height: 1 },
      })
    );
    expect(result.count).toBe(2);
    expect(result.cards).toEqual([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ]);
    expect(result.summary).toContain('2 cards');
    expect(result.summary).toContain('create_deck');
  });

  it('accepts a bare base64 string without a data URL prefix', async () => {
    const generateCards = jest.fn(async () => visionResult([]));
    const { service } = makeService({ generateCards });
    await service.photoToDeck({ image: ONE_PIXEL_PNG_BASE64 }, 'o', {});
    expect(generateCards).toHaveBeenCalledWith(
      expect.objectContaining({ imageBase64: ONE_PIXEL_PNG_BASE64 })
    );
  });

  it('forwards density and mode to the vision use case', async () => {
    const generateCards = jest.fn(async () => visionResult([]));
    const { service } = makeService({ generateCards });
    await service.photoToDeck(
      { image: ONE_PIXEL_PNG_BASE64, density: 'dense', mode: 'verbatim' },
      'o',
      {}
    );
    expect(generateCards).toHaveBeenCalledWith(
      expect.objectContaining({ density: 'dense', mode: 'verbatim' })
    );
  });

  it('rejects an empty image without calling vision', async () => {
    const generateCards = jest.fn();
    const { service } = makeService({ generateCards });
    await expect(
      service.photoToDeck({ image: '   ' }, 'o', {})
    ).rejects.toThrow(/base64/);
    expect(generateCards).not.toHaveBeenCalled();
  });

  it('rejects a non-image payload without calling vision', async () => {
    const generateCards = jest.fn();
    const { service } = makeService({ generateCards });
    const notAnImage = Buffer.from('this is plain text').toString('base64');
    await expect(
      service.photoToDeck({ image: notAnImage }, 'o', {})
    ).rejects.toThrow(/Unsupported image type/);
    expect(generateCards).not.toHaveBeenCalled();
  });

  it('rejects an oversized image without calling vision', async () => {
    const generateCards = jest.fn();
    const { service } = makeService({ generateCards });
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64');
    await expect(
      service.photoToDeck({ image: oversized }, 'o', {})
    ).rejects.toThrow(/10 MB/);
    expect(generateCards).not.toHaveBeenCalled();
  });

  it('surfaces a quota-exceeded error from the vision use case', async () => {
    const quotaError = Object.assign(
      new Error('Free plan is 5 photos per month. Upgrade for unlimited.'),
      { status: 429 }
    );
    const generateCards = jest.fn(async () => {
      throw quotaError;
    });
    const { service } = makeService({ generateCards });
    await expect(
      service.photoToDeck({ image: ONE_PIXEL_PNG_BASE64 }, 'o', {})
    ).rejects.toThrow(/Free plan is 5 photos per month/);
  });
});

describe('McpToolsService.createDeck with subdecks', () => {
  let workspaceBase: string;
  let priorWorkspaceBase: string | undefined;
  let priorSkip: string | undefined;

  beforeAll(() => {
    priorWorkspaceBase = process.env.WORKSPACE_BASE;
    priorSkip = process.env.SKIP_CREATE_DECK;
    workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-subdeck-'));
    process.env.WORKSPACE_BASE = workspaceBase;
    process.env.SKIP_CREATE_DECK = '1';
  });

  afterAll(() => {
    if (priorWorkspaceBase == null) {
      delete process.env.WORKSPACE_BASE;
    } else {
      process.env.WORKSPACE_BASE = priorWorkspaceBase;
    }
    if (priorSkip == null) {
      delete process.env.SKIP_CREATE_DECK;
    } else {
      process.env.SKIP_CREATE_DECK = priorSkip;
    }
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  const subdeckCards = () => [
    { front: 'ichi', back: '1', deck: 'Vocabulary' },
    { front: 'taberu', back: 'to eat', deck: 'Grammar' },
    { front: 'ni', back: '2', deck: 'Vocabulary' },
  ];

  it('builds one deck per composed subdeck name with the right per-deck card counts', async () => {
    const { service, persist } = makeService({});
    const result = await service.createDeck(
      subdeckCards(),
      'JLPT N5',
      undefined,
      'owner-9',
      {}
    );

    expect(persist).toHaveBeenCalledTimes(1);
    const deckInfoBuffer = persist.mock.calls[0][3] as Buffer;
    const decks = JSON.parse(deckInfoBuffer.toString('utf-8')) as {
      name: string;
      cards: unknown[];
    }[];
    const byName = new Map(decks.map((deck) => [deck.name, deck.cards.length]));
    expect(byName.get('JLPT N5::Vocabulary')).toBe(2);
    expect(byName.get('JLPT N5::Grammar')).toBe(1);
    expect(byName.size).toBe(2);

    expect(result).toMatchObject({
      kind: 'deck',
      cardCount: 3,
      filename: 'JLPT N5.apkg',
      summary: 'Deck ready: JLPT N5 — 3 cards across 2 subdecks.',
      applied: {
        subdecks: [
          { deck: 'JLPT N5::Grammar', cards: 1 },
          { deck: 'JLPT N5::Vocabulary', cards: 2 },
        ],
      },
    });
  });

  it('keeps noteType basic and reports it ignored when subdeck cards are involved', async () => {
    const { service } = makeService({});
    const result = await service.createDeck(
      subdeckCards(),
      'JLPT N5',
      { noteType: 'input', tags: ['jp'] },
      'owner-9',
      {}
    );
    expect(result).toMatchObject({
      kind: 'deck',
      applied: { noteType: 'basic', tags: [] },
      ignored: [
        {
          option: 'noteType',
          requested: 'input',
          reason:
            'Cards with a deck field always build as Basic; noteType only applies when no card sets deck.',
        },
        {
          option: 'tags',
          requested: ['jp'],
          reason:
            'Cards with a deck field always build with no tags; tags only apply when no card sets deck.',
        },
      ],
    });
  });

  it('increments card usage by the flat total across all subdecks', async () => {
    const incrementCardUsage = jest.fn();
    const { service } = makeService({ incrementCardUsage });
    await service.createDeck(
      subdeckCards(),
      'JLPT N5',
      undefined,
      'owner-9',
      {}
    );
    expect(incrementCardUsage).toHaveBeenCalledWith('owner-9', 3);
  });

  it('blocks an over-limit free user with the limit error and does not package or bill', async () => {
    const persist = jest.fn(async () => 'k');
    const incrementCardUsage = jest.fn();
    const getCardUsage = jest.fn(async () => ({ cards_used: 99 }));
    const { service } = makeService({
      persist,
      incrementCardUsage,
      getCardUsage,
    });
    const result = await service.createDeck(
      subdeckCards(),
      'JLPT N5',
      undefined,
      'owner-9',
      {}
    );
    expect(result).toEqual({
      kind: 'error',
      code: 'monthly_limit',
      message:
        "You've reached your free limit of 100 cards this month, so this deck wasn't created. Upgrade to Unlimited to keep converting, or wait for your limit to reset next month. Upgrade: https://2anki.net/pricing?from=mcp",
    });
    expect((result as { message: string }).message).toContain(
      'https://2anki.net/pricing?from=mcp'
    );
    expect(persist).not.toHaveBeenCalled();
    expect(incrementCardUsage).not.toHaveBeenCalled();
  });

  it('exempts a paying user from the monthly card limit', async () => {
    const incrementCardUsage = jest.fn();
    const getCardUsage = jest.fn(async () => ({ cards_used: 9999 }));
    const { service, persist } = makeService({
      incrementCardUsage,
      getCardUsage,
    });
    const result = await service.createDeck(
      subdeckCards(),
      'JLPT N5',
      undefined,
      'owner-9',
      { subscriber: true }
    );
    expect(result).toMatchObject({ kind: 'deck', cardCount: 3 });
    expect(getCardUsage).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(incrementCardUsage).toHaveBeenCalledWith('owner-9', 3);
  });

  it('keeps deckless cards in the bare parent bucket alongside subdecks', async () => {
    const { service, persist } = makeService({});
    await service.createDeck(
      [
        { front: 'intro', back: 'welcome' },
        { front: 'ichi', back: '1', deck: 'Vocabulary' },
      ],
      'JLPT N5',
      undefined,
      'owner-9',
      {}
    );
    const deckInfoBuffer = persist.mock.calls[0][3] as Buffer;
    const decks = JSON.parse(deckInfoBuffer.toString('utf-8')) as {
      name: string;
      cards: unknown[];
    }[];
    const byName = new Map(decks.map((deck) => [deck.name, deck.cards.length]));
    expect(byName.get('JLPT N5')).toBe(1);
    expect(byName.get('JLPT N5::Vocabulary')).toBe(1);
  });

  it('takes the flat path untouched when no card carries a deck', async () => {
    let uploadedBody: Record<string, unknown> | undefined;
    const entry: UploadEntrypoint = (req, res) => {
      uploadedBody = (req as unknown as { body: Record<string, unknown> }).body;
      res.set('X-Card-Count', '2');
      res.set('File-Name', 'deck.apkg');
      res.status(200).send(Buffer.from('APKG-BYTES'));
    };
    const { service, persist } = makeService({ uploadEntry: entry });
    const result = await service.createDeck(
      [
        { front: 'a', back: 'b' },
        { front: 'c', back: 'd' },
      ],
      'JLPT N5',
      undefined,
      'owner-9',
      {}
    );
    expect(uploadedBody).toEqual({ deckName: 'JLPT N5' });
    expect((result as { applied?: unknown }).applied).toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
