import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import {
  AI_CHOICE_AT_KEY,
  accountChoiceAllowsClaude,
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

describe('claudeCardsByDefault for an account the free AI gift pays for', () => {
  const giftPays = (pays: boolean) => vi.fn().mockResolvedValue(pays);
  const giftPdf = (
    overrides: Partial<ClaudeDefaultCandidate> = {}
  ): ClaudeDefaultCandidate =>
    paidPdf({ paying: false, giftPays: giftPays(true), ...overrides });

  it('turns Claude on for a PDF when the gift pays and the account never chose', async () => {
    expect(await claudeCardsByDefault(giftPdf(), NO_HISTORY)).toBe(true);
  });

  it('keeps AI off when the gift would not pay for this upload', async () => {
    expect(
      await claudeCardsByDefault(
        giftPdf({ giftPays: giftPays(false) }),
        NO_HISTORY
      )
    ).toBe(false);
  });

  it('keeps AI off when the gift read fails', async () => {
    expect(
      await claudeCardsByDefault(
        giftPdf({ giftPays: vi.fn().mockRejectedValue(new Error('db')) }),
        NO_HISTORY
      )
    ).toBe(false);
  });

  it('keeps an off the account recorded, even with a paying gift', async () => {
    expect(
      await claudeCardsByDefault(giftPdf(), historyOf('upload_ai_turned_off'))
    ).toBe(false);
    expect(
      await claudeCardsByDefault(
        giftPdf({ options: { [AI_CHOICE_AT_KEY]: '1762300000' } }),
        NO_HISTORY
      )
    ).toBe(false);
  });

  it('leaves an upload the account already turned AI on for alone', async () => {
    expect(
      await claudeCardsByDefault(
        giftPdf({ options: { 'claude-ai-flashcards': 'true' } }),
        NO_HISTORY
      )
    ).toBe(false);
  });

  it.each<[string, Partial<ClaudeDefaultCandidate>]>([
    ['an MCP caller', { entry: 'mcp' }],
    ['the iOS app', { entry: 'app' }],
    ['a markdown upload', { fileNames: ['notes.md'] }],
    ['a signed-out visitor', { ownerId: null }],
  ])(
    'leaves %s unchanged, without reading the gift',
    async (_label, overrides) => {
      const gift = giftPays(true);

      expect(
        await claudeCardsByDefault(
          giftPdf({ ...overrides, giftPays: gift }),
          NO_HISTORY
        )
      ).toBe(false);
      expect(gift).not.toHaveBeenCalled();
    }
  );

  it('never reads the gift for a paying account', async () => {
    const gift = giftPays(false);

    expect(
      await claudeCardsByDefault(paidPdf({ giftPays: gift }), NO_HISTORY)
    ).toBe(true);
    expect(gift).not.toHaveBeenCalled();
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

const SHARED_RULE_ON_MAIN = {
  cases: 79_310,
  on: 559,
  digest: '80b1a222e6f37d2ad00517390da522d757f1f690d66f54310f27033c30a94517',
};

const MATRIX_STORED: unknown[] = [
  null,
  {},
  'not an object',
  ['claude-ai-flashcards'],
  { 'claude-ai-flashcards': 'true' },
  { 'claude-ai-flashcards': 'false' },
  { 'claude-ai-flashcards': '' },
  { 'claude-ai-flashcards': 'false', [AI_CHOICE_AT_KEY]: '1762300000' },
  { [AI_CHOICE_AT_KEY]: '1762300000' },
  { [AI_CHOICE_AT_KEY]: '' },
  { 'pdf-page-pairs': 'true' },
];

const MATRIX_LATEST: (string | Error | null)[] = [
  null,
  'upload_ai_turned_on',
  'upload_ai_turned_off',
  'upload_started',
  new Error('history read failed'),
];

function matrixHistory(latest: string | Error | null): AiChoiceHistoryReader {
  return {
    latestAiToggleEventName: async () => {
      if (latest instanceof Error) throw latest;
      return latest;
    },
  };
}

async function sharedRuleOutputs(): Promise<string> {
  const ownerIds = [null, 7];
  const entries = ['web', 'mcp', 'app'] as const;
  const fileSets = [
    ['lecture.pdf'],
    ['slides.pptx'],
    ['export.zip'],
    ['lecture.pdf', 'notes.md'],
    [],
  ];
  const requestOptions: Record<string, unknown>[] = [
    {},
    { 'claude-ai-flashcards': 'true' },
    { 'claude-ai-flashcards': 'false' },
    { 'pdf-page-pairs': 'true' },
    { [AI_CHOICE_AT_KEY]: '1762300000' },
    { 'claude-ai-flashcards': 'false', [AI_CHOICE_AT_KEY]: '1762300000' },
  ];
  const giftPaysVariants: (ClaudeDefaultCandidate['giftPays'] | undefined)[] = [
    undefined,
    async () => true,
    async () => false,
    async () => {
      throw new Error('gift read failed');
    },
  ];
  let bits = '';
  for (const ownerId of ownerIds) {
    for (const paying of [true, false]) {
      for (const entry of entries) {
        for (const fileNames of fileSets) {
          for (const options of requestOptions) {
            for (const storedOptions of MATRIX_STORED) {
              for (const giftPays of giftPaysVariants) {
                for (const latest of MATRIX_LATEST) {
                  const on = await claudeCardsByDefault(
                    {
                      ownerId,
                      paying,
                      entry,
                      fileNames,
                      options,
                      storedOptions,
                      giftPays,
                    },
                    matrixHistory(latest)
                  );
                  bits += on ? '1' : '0';
                }
              }
            }
          }
        }
      }
    }
  }
  for (const paying of [true, false]) {
    for (const stored of MATRIX_STORED) {
      for (const latest of MATRIX_LATEST) {
        const on = await accountHasClaudeCardsByDefault(
          7,
          paying,
          stored,
          matrixHistory(latest)
        );
        bits += on ? '1' : '0';
      }
    }
  }
  return bits;
}

describe('the shared Claude default rule, for uploads without the card switch', () => {
  it('answers every case in the matrix exactly as main did before the card switch changed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const bits = await sharedRuleOutputs();

    expect({
      cases: bits.length,
      on: bits.split('').filter((bit) => bit === '1').length,
      digest: createHash('sha256').update(bits).digest('hex'),
    }).toEqual(SHARED_RULE_ON_MAIN);
  });
});

describe('accountChoiceAllowsClaude', () => {
  it.each<[string, Record<string, string> | null, string | null, boolean]>([
    ['nothing stored or recorded', null, null, true],
    ['a stored on', { 'claude-ai-flashcards': 'true' }, null, true],
    [
      'a recorded off',
      { 'claude-ai-flashcards': 'false', [AI_CHOICE_AT_KEY]: '1762300000' },
      null,
      false,
    ],
    [
      'a recorded off with a later toggle on',
      { 'claude-ai-flashcards': 'false', [AI_CHOICE_AT_KEY]: '1762300000' },
      'upload_ai_turned_on',
      false,
    ],
    [
      'a recorded choice with Claude never stored',
      { [AI_CHOICE_AT_KEY]: '1762300000' },
      null,
      false,
    ],
    ['a latest toggle off', null, 'upload_ai_turned_off', false],
    ['a latest toggle on', null, 'upload_ai_turned_on', true],
    [
      'a stored off with no record, as a settings sync writes it',
      { 'claude-ai-flashcards': 'false' },
      null,
      true,
    ],
    [
      'a stored off with a latest toggle off',
      { 'claude-ai-flashcards': 'false' },
      'upload_ai_turned_off',
      false,
    ],
    [
      'a stored off followed by a toggle on',
      { 'claude-ai-flashcards': 'false' },
      'upload_ai_turned_on',
      true,
    ],
    [
      'a stored on with a recorded choice',
      { 'claude-ai-flashcards': 'true', [AI_CHOICE_AT_KEY]: '1762300000' },
      null,
      true,
    ],
  ])('answers %s', async (_case, stored, latest, allows) => {
    expect(await accountChoiceAllowsClaude(7, stored, historyOf(latest))).toBe(
      allows
    );
  });

  it('keeps the switch off when the toggle history cannot be read', async () => {
    const failing: AiChoiceHistoryReader = {
      latestAiToggleEventName: vi.fn().mockRejectedValue(new Error('db down')),
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      await accountChoiceAllowsClaude(
        7,
        { 'claude-ai-flashcards': 'false' },
        failing
      )
    ).toBe(false);
  });
});
