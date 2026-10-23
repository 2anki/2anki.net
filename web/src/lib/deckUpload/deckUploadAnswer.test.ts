import { describe, expect, it } from 'vitest';
import {
  deckLabel,
  readDeckUploadAnswer,
  readHandoffFile,
} from './deckUploadAnswer';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('readDeckUploadAnswer', () => {
  it('reads the decks to choose from', async () => {
    await expect(
      readDeckUploadAnswer(
        jsonResponse(409, { code: 'choose_deck', decks: ['a/One.apkg'] })
      )
    ).resolves.toEqual({ kind: 'choose_deck', decks: ['a/One.apkg'] });
  });

  it('reads a zip of notes', async () => {
    await expect(
      readDeckUploadAnswer(jsonResponse(422, { code: 'not_a_deck' }))
    ).resolves.toEqual({ kind: 'not_a_deck' });
  });

  it('leaves every other answer to the caller', async () => {
    await expect(
      readDeckUploadAnswer(jsonResponse(400, { code: 'not_a_deck' }))
    ).resolves.toBeNull();
    await expect(
      readDeckUploadAnswer(jsonResponse(409, { code: 'something_else' }))
    ).resolves.toBeNull();
  });
});

describe('deckLabel', () => {
  it('shows the deck name without its folder or extension', () => {
    expect(deckLabel('export/Biology 101.apkg')).toBe('Biology 101');
  });
});

describe('readHandoffFile', () => {
  it('returns the handed-off file and ignores anything else', () => {
    const file = new File(['x'], 'deck.zip');
    expect(readHandoffFile({ handoffFile: file })).toBe(file);
    expect(readHandoffFile({ handoffFile: 'deck.zip' })).toBeNull();
    expect(readHandoffFile(null)).toBeNull();
  });
});
