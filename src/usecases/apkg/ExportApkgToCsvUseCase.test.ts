import ExportApkgToCsvUseCase, {
  EmptyDeckError,
  CardLimitExceededError,
  CSV_FREE_NOTE_LIMIT,
  CSV_ANONYMOUS_NOTE_LIMIT,
} from './ExportApkgToCsvUseCase';
import * as parseApkgNotesModule from '../../services/ApkgPreviewService/parseApkgNotes';
import { ParsedNote } from '../../lib/ankify/transforms/types';

function note(fields: string[], tags: string[] = []): ParsedNote {
  return {
    guid: `g-${fields.join('-')}`,
    modelKind: 'basic',
    modelName: 'Basic',
    fields,
    fieldNames: ['Front', 'Back'],
    tags,
  };
}

describe('ExportApkgToCsvUseCase', () => {
  const parseSpy = jest.spyOn(parseApkgNotesModule, 'parseApkgNotes');

  beforeEach(() => {
    parseSpy.mockReset();
  });

  it('returns CSV bytes, the deck name, and a note count for a valid .apkg', async () => {
    parseSpy.mockResolvedValue({
      notes: [note(['Q1', 'A1'], ['tagA']), note(['Q2', 'A2'])],
      unknownModelNames: [],
      deckName: 'Spanish 101',
      sourceMedia: [],
    });
    const useCase = new ExportApkgToCsvUseCase();
    const result = await useCase.execute(Buffer.from('fake-apkg'), null);
    expect(result.deckName).toBe('Spanish 101');
    expect(result.noteCount).toBe(2);
    const csv = result.csv.toString('utf8').replace(/^﻿/, '');
    expect(csv.split('\r\n')[0]).toBe('Model,Front,Back,Tags');
    expect(csv).toContain('Basic,Q1,A1,tagA');
    expect(csv).toContain('Basic,Q2,A2,');
  });

  it('throws EmptyDeckError when no notes are parsed from the file', async () => {
    parseSpy.mockResolvedValue({
      notes: [],
      unknownModelNames: ['Custom Note Type'],
      deckName: 'Empty',
      sourceMedia: [],
    });
    const useCase = new ExportApkgToCsvUseCase();
    await expect(
      useCase.execute(Buffer.from('fake-apkg'), CSV_FREE_NOTE_LIMIT)
    ).rejects.toBeInstanceOf(EmptyDeckError);
  });

  it('throws CardLimitExceededError for free users when notes exceed the cap', async () => {
    const many = Array.from({ length: CSV_FREE_NOTE_LIMIT + 1 }, (_, i) =>
      note([`Q${i}`, `A${i}`])
    );
    parseSpy.mockResolvedValue({
      notes: many,
      unknownModelNames: [],
      deckName: 'Big deck',
      sourceMedia: [],
    });
    const useCase = new ExportApkgToCsvUseCase();
    await expect(
      useCase.execute(Buffer.from('fake-apkg'), CSV_FREE_NOTE_LIMIT)
    ).rejects.toBeInstanceOf(CardLimitExceededError);
  });

  it('does not apply the cap when the caller is unlimited', async () => {
    const many = Array.from({ length: CSV_FREE_NOTE_LIMIT + 100 }, (_, i) =>
      note([`Q${i}`, `A${i}`])
    );
    parseSpy.mockResolvedValue({
      notes: many,
      unknownModelNames: [],
      deckName: 'Big deck',
      sourceMedia: [],
    });
    const useCase = new ExportApkgToCsvUseCase();
    const result = await useCase.execute(Buffer.from('fake-apkg'), null);
    expect(result.noteCount).toBe(CSV_FREE_NOTE_LIMIT + 100);
  });

  it('returns CSV as a UTF-8 Buffer with a BOM so Excel opens accented text cleanly', async () => {
    parseSpy.mockResolvedValue({
      notes: [note(['¿Cómo estás?', 'Bien'])],
      unknownModelNames: [],
      deckName: 'Español',
      sourceMedia: [],
    });
    const useCase = new ExportApkgToCsvUseCase();
    const result = await useCase.execute(Buffer.from('fake-apkg'), null);
    expect(result.csv[0]).toBe(0xef);
    expect(result.csv[1]).toBe(0xbb);
    expect(result.csv[2]).toBe(0xbf);
    expect(result.csv.toString('utf8')).toContain('¿Cómo estás?');
  });
});

describe('ExportApkgToCsvUseCase note limit tiers', () => {
  const parseSpyFor = (count: number) =>
    jest.spyOn(parseApkgNotesModule, 'parseApkgNotes').mockResolvedValue({
      notes: Array.from({ length: count }, (_, i) => note([`Q${i}`, `A${i}`])),
      unknownModelNames: [],
      deckName: 'Deck',
      sourceMedia: [],
    });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['anonymous', CSV_ANONYMOUS_NOTE_LIMIT],
    ['free account', CSV_FREE_NOTE_LIMIT],
  ])('exports exactly the cap for %s', async (_tier, cap) => {
    parseSpyFor(cap);
    const result = await new ExportApkgToCsvUseCase().execute(
      Buffer.from('fake-apkg'),
      cap
    );
    expect(result.noteCount).toBe(cap);
  });

  it.each([
    ['anonymous', CSV_ANONYMOUS_NOTE_LIMIT],
    ['free account', CSV_FREE_NOTE_LIMIT],
  ])('rejects one note over the cap for %s', async (_tier, cap) => {
    parseSpyFor(cap + 1);
    await expect(
      new ExportApkgToCsvUseCase().execute(Buffer.from('fake-apkg'), cap)
    ).rejects.toMatchObject({
      name: 'CardLimitExceededError',
      noteCount: cap + 1,
      noteLimit: cap,
    });
  });

  it('treats a cap of 0 as a cap, not as unlimited', async () => {
    parseSpyFor(1);
    await expect(
      new ExportApkgToCsvUseCase().execute(Buffer.from('fake-apkg'), 0)
    ).rejects.toBeInstanceOf(CardLimitExceededError);
  });

  it('exports a deck far over the free cap when the caller is unlimited', async () => {
    parseSpyFor(CSV_FREE_NOTE_LIMIT * 5);
    const result = await new ExportApkgToCsvUseCase().execute(
      Buffer.from('fake-apkg'),
      null
    );
    expect(result.noteCount).toBe(CSV_FREE_NOTE_LIMIT * 5);
  });
});
