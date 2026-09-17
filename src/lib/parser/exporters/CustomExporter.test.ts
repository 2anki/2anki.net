import os from 'os';
import path from 'path';
import fs from 'fs';

import CustomExporter from './CustomExporter';
import { DeckTooLargeError } from './DeckTooLargeError';
import Deck from '../Deck';
import Note from '../Note';
import CardOption from '../Settings';
import CardGenerator from '../../anki/CardGenerator';

jest.mock('../../anki/CardGenerator');

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'custom-exporter-test-'));
}

function emptySettings(): CardOption {
  return new CardOption({});
}

function autoDetectSettings(): CardOption {
  return new CardOption({ 'tts-auto-detect': 'true' });
}

function deckWithCards(
  name: string,
  fronts: string[],
  settings: CardOption
): Deck {
  const cards = fronts.map((front) => new Note(front, ''));
  return new Deck(name, cards, '', '', 1, settings);
}

describe('CustomExporter.configure', () => {
  it('throws DeckTooLargeError when JSON.stringify throws a RangeError', () => {
    const dir = tempDir();
    const exporter = new CustomExporter('test-deck', dir);

    const originalStringify = JSON.stringify;
    JSON.stringify = () => {
      throw new RangeError('Invalid string length');
    };

    try {
      expect(() => exporter.configure([] as Deck[])).toThrow(DeckTooLargeError);
    } finally {
      JSON.stringify = originalStringify;
    }
  });

  it('re-throws non-RangeError exceptions from JSON.stringify unchanged', () => {
    const dir = tempDir();
    const exporter = new CustomExporter('test-deck', dir);

    const originalStringify = JSON.stringify;
    JSON.stringify = () => {
      throw new TypeError('unexpected');
    };

    try {
      expect(() => exporter.configure([] as Deck[])).toThrow(TypeError);
    } finally {
      JSON.stringify = originalStringify;
    }
  });

  it('writes deck_info.json when serialization succeeds', () => {
    const dir = tempDir();
    const exporter = new CustomExporter('test-deck', dir);
    const deck = new Deck(
      'My Deck',
      [],
      '',
      '',
      1234567890123456,
      emptySettings()
    );

    exporter.configure([deck]);

    const written = fs.readFileSync(path.join(dir, 'deck_info.json'), 'utf8');
    const parsed = JSON.parse(written);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe('My Deck');
  });

  it('leaves frontLang empty when auto-detect is off', () => {
    const dir = tempDir();
    const exporter = new CustomExporter('test-deck', dir);
    const deck = deckWithCards(
      'JP',
      ['こんにちは', 'ありがとう'],
      emptySettings()
    );

    exporter.configure([deck]);

    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, 'deck_info.json'), 'utf8')
    );
    expect(parsed[0].settings.frontLang).toBe('');
  });

  it('writes detected frontLang when auto-detect is on and CJK dominates', () => {
    const dir = tempDir();
    const exporter = new CustomExporter('test-deck', dir);
    const deck = deckWithCards(
      'JP',
      ['こんにちは', 'ありがとう', 'すみません'],
      autoDetectSettings()
    );

    exporter.configure([deck]);

    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, 'deck_info.json'), 'utf8')
    );
    expect(parsed[0].settings.frontLang).toBe('ja');
  });

  it('falls back to en when auto-detect is on and text is ASCII', () => {
    const dir = tempDir();
    const exporter = new CustomExporter('test-deck', dir);
    const deck = deckWithCards('EN', ['hello', 'thanks'], autoDetectSettings());

    exporter.configure([deck]);

    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, 'deck_info.json'), 'utf8')
    );
    expect(parsed[0].settings.frontLang).toBe('en');
  });

  it('serializes the manual TTS language and side into deck_info.json', () => {
    const dir = tempDir();
    const exporter = new CustomExporter('test-deck', dir);
    const settings = new CardOption({
      'tts-manual-lang': 'ja_JP',
      'tts-manual-side': 'both',
    });
    const deck = deckWithCards('JP', ['front'], settings);

    exporter.configure([deck]);

    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, 'deck_info.json'), 'utf8')
    );
    expect(parsed[0].settings.ttsManualLang).toBe('ja_JP');
    expect(parsed[0].settings.ttsManualSide).toBe('both');
  });

  it('skips auto-detect when a manual TTS language is set', () => {
    const dir = tempDir();
    const exporter = new CustomExporter('test-deck', dir);
    const settings = new CardOption({
      'tts-auto-detect': 'true',
      'tts-manual-lang': 'es_ES',
      'tts-manual-side': 'front',
    });
    const deck = deckWithCards(
      'JP',
      ['こんにちは', 'ありがとう', 'すみません'],
      settings
    );

    exporter.configure([deck]);

    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, 'deck_info.json'), 'utf8')
    );
    expect(parsed[0].settings.frontLang).toBe('');
    expect(parsed[0].settings.ttsManualLang).toBe('es_ES');
  });
});

describe('CustomExporter.save', () => {
  const MockCardGenerator = CardGenerator as jest.MockedClass<
    typeof CardGenerator
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockGenRun(apkgPath: string) {
    MockCardGenerator.mockImplementation(
      () =>
        ({
          run: jest.fn().mockResolvedValue(apkgPath),
        }) as unknown as InstanceType<typeof CardGenerator>
    );
  }

  it('reads back the apkg CardGenerator reports', async () => {
    const dir = tempDir();
    const apkgPath = path.join(dir, 'deck.apkg');
    fs.writeFileSync(apkgPath, 'apkg-bytes');
    mockGenRun(apkgPath);
    const exporter = new CustomExporter('test-deck', dir);

    const buffer = await exporter.save();

    expect(buffer.toString('utf8')).toBe('apkg-bytes');
  });

  it('waits for a slow-to-appear apkg instead of failing immediately', async () => {
    const dir = tempDir();
    const apkgPath = path.join(dir, 'deck.apkg');
    mockGenRun(apkgPath);
    const exporter = new CustomExporter('test-deck', dir);

    setTimeout(() => fs.writeFileSync(apkgPath, 'late-bytes'), 150);
    const buffer = await exporter.save();

    expect(buffer.toString('utf8')).toBe('late-bytes');
  });

  it('rejects with a real, code-tagged ENOENT when the apkg never appears', async () => {
    const dir = tempDir();
    const apkgPath = path.join(dir, 'never-written.apkg');
    mockGenRun(apkgPath);
    const exporter = new CustomExporter('test-deck', dir);

    const error = (await exporter
      .save()
      .catch((e) => e)) as NodeJS.ErrnoException;

    expect(error.code).toBe('ENOENT');
    expect(typeof error.errno).toBe('number');
    expect(error.message).toContain('never-written.apkg');
  });
});

describe('CustomExporter.addMedia', () => {
  it('writes a normal media file inside the workspace and returns its path', () => {
    const dir = tempDir();
    const exporter = new CustomExporter('test-deck', dir);

    const written = exporter.addMedia('2anki-abc123.png', Buffer.from('x'));

    expect(written).toBe(path.join(dir, '2anki-abc123.png'));
    expect(fs.readFileSync(written, 'utf8')).toBe('x');
    expect(exporter.media).toContain(written);
  });

  it('neutralizes a traversal media name and writes inside the workspace only', () => {
    const root = tempDir();
    const dir = fs.mkdtempSync(path.join(root, 'ws-'));
    const escapeMarker = path.join(root, 'escape.js');
    const exporter = new CustomExporter('test-deck', dir);

    const written = exporter.addMedia(
      '../../escape.js',
      Buffer.from('payload')
    );

    expect(written).toBe(path.join(dir, 'escape.js'));
    expect(fs.existsSync(escapeMarker)).toBe(false);
    expect(fs.readFileSync(written, 'utf8')).toBe('payload');
  });

  it('neutralizes an absolute media path to a basename inside the workspace', () => {
    const root = tempDir();
    const dir = fs.mkdtempSync(path.join(root, 'ws-'));
    const target = path.join(root, 'absolute-escape.js');
    const exporter = new CustomExporter('test-deck', dir);

    const written = exporter.addMedia(target, Buffer.from('payload'));

    expect(written).toBe(path.join(dir, 'absolute-escape.js'));
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(written, 'utf8')).toBe('payload');
  });
});
