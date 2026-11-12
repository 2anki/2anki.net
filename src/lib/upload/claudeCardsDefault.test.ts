import { vi } from 'vitest';
import {
  AI_CHOICE_AT_KEY,
  accountHasClaudeCardsByDefault,
  claudeCardsByDefault,
  type AiChoiceHistoryReader,
  type ClaudeDefaultCandidate,
} from './claudeCardsDefault';

function historyOf(latest: string | null): AiChoiceHistoryReader {
  return { latestAiToggleEventName: vi.fn().mockResolvedValue(latest) };
}

const NO_HISTORY = historyOf(null);

function paidPdf(
  overrides: Partial<ClaudeDefaultCandidate> = {}
): ClaudeDefaultCandidate {
  return {
    ownerId: 7,
    paying: true,
    entry: 'web',
    fileNames: ['lecture.pdf'],
    options: {},
    storedOptions: null,
    ...overrides,
  };
}

describe('claudeCardsByDefault', () => {
  it('turns Claude on for a paying account uploading a PDF it never chose a setting for', async () => {
    expect(await claudeCardsByDefault(paidPdf(), NO_HISTORY)).toBe(true);
  });

  it.each(['slides.pptx', 'slides.ppt', 'LECTURE.PDF'])(
    'treats %s like a PDF',
    async (name) => {
      expect(
        await claudeCardsByDefault(paidPdf({ fileNames: [name] }), NO_HISTORY)
      ).toBe(true);
    }
  );

  it('keeps a stored off with no recorded toggle off, since it may have been a choice', async () => {
    expect(
      await claudeCardsByDefault(
        paidPdf({
          options: { 'claude-ai-flashcards': 'false' },
          storedOptions: { 'claude-ai-flashcards': 'false' },
        }),
        NO_HISTORY
      )
    ).toBe(false);
  });

  it('follows the account, not a browser off the account never stored, so the badge and upload agree', async () => {
    expect(
      await claudeCardsByDefault(
        paidPdf({
          options: { 'claude-ai-flashcards': 'false' },
          storedOptions: {},
        }),
        NO_HISTORY
      )
    ).toBe(true);
  });

  it('keeps AI off when the account recorded the off choice', async () => {
    expect(
      await claudeCardsByDefault(
        paidPdf({
          options: {
            'claude-ai-flashcards': 'false',
            [AI_CHOICE_AT_KEY]: '1762300000',
          },
        }),
        NO_HISTORY
      )
    ).toBe(false);
  });

  it('keeps AI off when the latest toggle the account made was off', async () => {
    expect(
      await claudeCardsByDefault(
        paidPdf({ options: { 'claude-ai-flashcards': 'false' } }),
        historyOf('upload_ai_turned_off')
      )
    ).toBe(false);
  });

  it('turns Claude on when the latest toggle the account made was on', async () => {
    expect(
      await claudeCardsByDefault(
        paidPdf({ options: { 'claude-ai-flashcards': 'false' } }),
        historyOf('upload_ai_turned_on')
      )
    ).toBe(true);
  });

  it('keeps AI off when the toggle history cannot be read', async () => {
    const failing: AiChoiceHistoryReader = {
      latestAiToggleEventName: vi.fn().mockRejectedValue(new Error('down')),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await claudeCardsByDefault(paidPdf(), failing)).toBe(false);
    warn.mockRestore();
  });

  it('leaves an upload that already has AI on alone', async () => {
    const reader = historyOf(null);

    expect(
      await claudeCardsByDefault(
        paidPdf({ options: { 'claude-ai-flashcards': 'true' } }),
        reader
      )
    ).toBe(false);
    expect(reader.latestAiToggleEventName).not.toHaveBeenCalled();
  });

  it('keeps PDF page pairs when the person chose them', async () => {
    expect(
      await claudeCardsByDefault(
        paidPdf({ options: { 'pdf-page-pairs': 'true' } }),
        NO_HISTORY
      )
    ).toBe(false);
  });

  it.each<[string, Partial<ClaudeDefaultCandidate>]>([
    ['a free account', { paying: false }],
    ['a signed-out visitor', { ownerId: null }],
    ['an MCP caller', { entry: 'mcp' }],
    ['the iOS app', { entry: 'app' }],
    ['a markdown upload', { fileNames: ['notes.md'] }],
    ['a zip upload', { fileNames: ['export.zip'] }],
    ['a PDF sent with a markdown file', { fileNames: ['a.pdf', 'b.md'] }],
    ['an upload with no files', { fileNames: [] }],
  ])('leaves %s unchanged', async (_label, overrides) => {
    const reader = historyOf(null);

    expect(await claudeCardsByDefault(paidPdf(overrides), reader)).toBe(false);
    expect(reader.latestAiToggleEventName).not.toHaveBeenCalled();
  });
});

describe('accountHasClaudeCardsByDefault', () => {
  it('is on for a paying account with nothing stored', async () => {
    expect(
      await accountHasClaudeCardsByDefault(7, true, null, NO_HISTORY)
    ).toBe(true);
  });

  it('is off for a free account', async () => {
    expect(
      await accountHasClaudeCardsByDefault(7, false, null, NO_HISTORY)
    ).toBe(false);
  });

  it('is off once the account recorded a choice', async () => {
    expect(
      await accountHasClaudeCardsByDefault(
        7,
        true,
        { 'claude-ai-flashcards': 'false', [AI_CHOICE_AT_KEY]: '1762300000' },
        NO_HISTORY
      )
    ).toBe(false);
  });

  it('is off when the latest recorded toggle was off', async () => {
    expect(
      await accountHasClaudeCardsByDefault(
        7,
        true,
        { 'claude-ai-flashcards': 'false' },
        historyOf('upload_ai_turned_off')
      )
    ).toBe(false);
  });

  it('is off for a stored off with no recorded toggle', async () => {
    expect(
      await accountHasClaudeCardsByDefault(
        7,
        true,
        { 'claude-ai-flashcards': 'false' },
        NO_HISTORY
      )
    ).toBe(false);
  });

  it('is on for a stored off whose latest recorded toggle was on', async () => {
    expect(
      await accountHasClaudeCardsByDefault(
        7,
        true,
        { 'claude-ai-flashcards': 'false' },
        historyOf('upload_ai_turned_on')
      )
    ).toBe(true);
  });

  it('is off when AI is already on, since the badge already says so', async () => {
    expect(
      await accountHasClaudeCardsByDefault(
        7,
        true,
        { 'claude-ai-flashcards': 'true' },
        NO_HISTORY
      )
    ).toBe(false);
  });
});
