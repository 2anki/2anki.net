import {
  ChatDeckUseCase,
  looksLikeCloze,
  transformBlankToCloze,
  normalizeBasicCard,
  stripClozeFromStem,
  type ChatDeckCard,
} from './ChatDeckUseCase';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import UsersRepository from '../../data_layer/UsersRepository';
import { MonthlyLimitError } from '../users/CheckMonthlyCardLimitUseCase';

jest.mock('../../lib/parser/exporters/CustomExporter');

const usersRepo = {
  getCardUsage: jest
    .fn()
    .mockResolvedValue({ cards_used: 0, month_started_at: null }),
  incrementCardUsage: jest.fn().mockResolvedValue(0),
} as unknown as UsersRepository;

const OWNER = { userId: 42, isPaying: true } as const;

function buildDeckUseCase(repo: UsersRepository = usersRepo) {
  return new ChatDeckUseCase(repo);
}

describe('stripClozeFromStem', () => {
  it('replaces a single cloze span with a blank', () => {
    expect(
      stripClozeFromStem(
        'Spring Boot uses {{c1::auto-configuration}} to detect deps.'
      )
    ).toBe('Spring Boot uses _____ to detect deps.');
  });

  it('replaces multiple cloze spans with separate blanks', () => {
    expect(stripClozeFromStem('{{c1::HTTP}} runs over {{c2::TCP}}.')).toBe(
      '_____ runs over _____.'
    );
  });

  it('leaves a stem without cloze syntax unchanged', () => {
    expect(stripClozeFromStem('Which protocol runs over TCP?')).toBe(
      'Which protocol runs over TCP?'
    );
  });

  it('does not reveal the deleted answer text', () => {
    const out = stripClozeFromStem(
      'Spring Boot uses {{c1::auto-configuration}} to detect deps.'
    );
    expect(out).not.toContain('auto-configuration');
    expect(out).not.toContain('{{c');
  });
});

describe('ChatDeckUseCase.execute MCQ handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CustomExporter as unknown as jest.Mock).mockImplementation(() => ({
      configure: jest.fn(),
      save: jest.fn().mockResolvedValue(Buffer.from('apkg')),
    }));
  });

  it('passes mcq:true with options and correctIndices to the exporter for MCQ cards', async () => {
    const useCase = buildDeckUseCase();
    await useCase.execute({
      ...OWNER,
      deckName: 'Quiz',
      cards: [
        {
          front: 'Which enzyme?',
          back: '',
          options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
          correctIndex: 1,
          rationale: 'Amylase hydrolyses starch.',
        },
      ],
    });

    const Mock = CustomExporter as unknown as jest.Mock;
    const configure = Mock.mock.results[0].value.configure as jest.Mock;
    const deckInfo = configure.mock.calls[0][0] as Array<{
      cards: Array<{
        mcq?: boolean;
        options?: string[];
        correctIndices?: number[];
        back: string;
      }>;
    }>;
    expect(deckInfo[0].cards[0]).toMatchObject({
      mcq: true,
      options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
      correctIndices: [1],
      back: 'Amylase hydrolyses starch.',
    });
  });

  it('keeps basic shape for cards without MCQ fields', async () => {
    const useCase = buildDeckUseCase();
    await useCase.execute({
      ...OWNER,
      deckName: 'Mix',
      cards: [{ front: 'Q', back: 'A' }],
    });
    const Mock = CustomExporter as unknown as jest.Mock;
    const configure = Mock.mock.results[0].value.configure as jest.Mock;
    const deckInfo = configure.mock.calls[0][0] as Array<{
      cards: Array<{ mcq?: boolean; back: string }>;
    }>;
    expect(deckInfo[0].cards[0].mcq).toBeUndefined();
    expect(deckInfo[0].cards[0].back).toBe('A');
  });

  it('passes per-card tags through to the exporter', async () => {
    const useCase = buildDeckUseCase();
    await useCase.execute({
      ...OWNER,
      deckName: 'Tagged',
      cards: [
        { front: 'Capital?', back: 'Oslo', tags: ['geography', 'norway'] },
        { front: '2+2', back: '4' },
      ],
    });
    const Mock = CustomExporter as unknown as jest.Mock;
    const configure = Mock.mock.results[0].value.configure as jest.Mock;
    const deckInfo = configure.mock.calls[0][0] as Array<{
      cards: Array<{ tags: string[] }>;
    }>;
    expect(deckInfo[0].cards[0].tags).toEqual(['geography', 'norway']);
    expect(deckInfo[0].cards[1].tags).toEqual([]);
  });
});

describe('ChatDeckUseCase.execute basic-and-reversed template', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CustomExporter as unknown as jest.Mock).mockImplementation(() => ({
      configure: jest.fn(),
      save: jest.fn().mockResolvedValue(Buffer.from('apkg')),
    }));
  });

  it('duplicates cards with swapped front/back when templateSlug is basic-and-reversed', async () => {
    const useCase = buildDeckUseCase();
    await useCase.execute({
      ...OWNER,
      deckName: 'Reversed',
      templateSlug: 'basic-and-reversed',
      cards: [{ front: 'Q', back: 'A' }],
    });
    const Mock = CustomExporter as unknown as jest.Mock;
    const configure = Mock.mock.results[0].value.configure as jest.Mock;
    const deckInfo = configure.mock.calls[0][0] as Array<{
      cards: Array<ChatDeckCard & { name: string; back: string }>;
    }>;
    expect(deckInfo[0].cards).toHaveLength(2);
    expect(deckInfo[0].cards[0]).toMatchObject({ name: 'Q', back: 'A' });
    expect(deckInfo[0].cards[1]).toMatchObject({ name: 'A', back: 'Q' });
  });

  it('does not add reversed card when back is empty', async () => {
    const useCase = buildDeckUseCase();
    await useCase.execute({
      ...OWNER,
      deckName: 'Empty back set',
      templateSlug: 'basic-and-reversed',
      cards: [{ front: 'A standalone prompt with no answer', back: '' }],
    });
    const Mock = CustomExporter as unknown as jest.Mock;
    const configure = Mock.mock.results[0].value.configure as jest.Mock;
    const deckInfo = configure.mock.calls[0][0] as Array<{
      cards: Array<{ name: string }>;
    }>;
    expect(deckInfo[0].cards).toHaveLength(1);
  });

  it('does not expand when templateSlug is basic', async () => {
    const useCase = buildDeckUseCase();
    await useCase.execute({
      ...OWNER,
      deckName: 'Basic set',
      templateSlug: 'basic',
      cards: [{ front: 'Q', back: 'A' }],
    });
    const Mock = CustomExporter as unknown as jest.Mock;
    const configure = Mock.mock.results[0].value.configure as jest.Mock;
    const deckInfo = configure.mock.calls[0][0] as Array<{
      cards: Array<{ name: string }>;
    }>;
    expect(deckInfo[0].cards).toHaveLength(1);
  });
});

describe('ChatDeckUseCase.execute cloze content under a basic template label', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CustomExporter as unknown as jest.Mock).mockImplementation(() => ({
      configure: jest.fn(),
      save: jest.fn().mockResolvedValue(Buffer.from('apkg')),
    }));
  });

  it('exports a normalized basic card when stray cloze content arrives under templateSlug basic', async () => {
    const useCase = buildDeckUseCase();
    await useCase.execute({
      ...OWNER,
      deckName: 'Mismatched',
      templateSlug: 'basic',
      cards: [{ front: 'The capital of France is {{c1::Paris}}.', back: '' }],
    });
    const Mock = CustomExporter as unknown as jest.Mock;
    const configure = Mock.mock.results[0].value.configure as jest.Mock;
    const deckInfo = configure.mock.calls[0][0] as Array<{
      cards: Array<{ cloze: boolean; name: string; back: string }>;
    }>;
    expect(deckInfo[0].cards[0].cloze).toBe(false);
    expect(deckInfo[0].cards[0].name).not.toContain('{{c');
    expect(deckInfo[0].cards[0].back).not.toContain('{{c');
    expect(deckInfo[0].cards[0].name).toBe('The capital of France is [...].');
    expect(deckInfo[0].cards[0].back).toBe('Paris');
  });

  it('normalizes stray cloze when templateSlug is basic-and-reversed', async () => {
    const useCase = buildDeckUseCase();
    await useCase.execute({
      ...OWNER,
      deckName: 'Reversed mismatch',
      templateSlug: 'basic-and-reversed',
      cards: [{ front: 'The capital of France is {{c1::Paris}}.', back: '' }],
    });
    const Mock = CustomExporter as unknown as jest.Mock;
    const configure = Mock.mock.results[0].value.configure as jest.Mock;
    const deckInfo = configure.mock.calls[0][0] as Array<{
      cards: Array<{ cloze: boolean; name: string; back: string }>;
    }>;
    for (const card of deckInfo[0].cards) {
      expect(card.cloze).toBe(false);
      expect(card.name).not.toContain('{{c');
      expect(card.back).not.toContain('{{c');
    }
  });

  it('keeps cloze:true when templateSlug is cloze', async () => {
    const useCase = buildDeckUseCase();
    await useCase.execute({
      ...OWNER,
      deckName: 'Cloze deck',
      templateSlug: 'cloze',
      cards: [{ front: 'The capital of France is {{c1::Paris}}.', back: '' }],
    });
    const Mock = CustomExporter as unknown as jest.Mock;
    const configure = Mock.mock.results[0].value.configure as jest.Mock;
    const deckInfo = configure.mock.calls[0][0] as Array<{
      cards: Array<{ cloze: boolean; name: string }>;
    }>;
    expect(deckInfo[0].cards[0].cloze).toBe(true);
    expect(deckInfo[0].cards[0].name).toBe(
      'The capital of France is {{c1::Paris}}.'
    );
  });
});

describe('normalizeBasicCard', () => {
  it('converts a single cloze front into a blanked front with the answer on the back', () => {
    expect(
      normalizeBasicCard({
        front: 'The capital of {{c1::France}} is Paris.',
        back: '',
      })
    ).toEqual({
      front: 'The capital of [...] is Paris.',
      back: 'France',
    });
  });

  it('joins multiple cloze answers on the back and blanks each on the front', () => {
    expect(
      normalizeBasicCard({
        front: '{{c1::Mitochondria}} is the {{c2::powerhouse}} of the cell.',
        back: '',
      })
    ).toEqual({
      front: '[...] is the [...] of the cell.',
      back: 'Mitochondria, powerhouse',
    });
  });

  it('strips HTML-embedded cloze markers while keeping surrounding markup', () => {
    expect(
      normalizeBasicCard({ front: '<p>Capital: {{c1::Oslo}}</p>', back: '' })
    ).toEqual({
      front: '<p>Capital: [...]</p>',
      back: 'Oslo',
    });
  });

  it('leaves a plain front/back card untouched', () => {
    const card = { front: 'What is the capital of Norway?', back: 'Oslo' };
    expect(normalizeBasicCard(card)).toEqual(card);
  });
});

describe('looksLikeCloze', () => {
  it('returns true for a single cloze marker', () => {
    expect(looksLikeCloze('Paris is the capital of {{c1::France}}')).toBe(true);
  });

  it('returns true for multi-digit cloze numbers', () => {
    expect(looksLikeCloze('{{c12::elephant}} memory')).toBe(true);
  });

  it('returns true when more than one cloze marker is present', () => {
    expect(
      looksLikeCloze(
        '{{c1::mitochondria}} is the {{c2::powerhouse}} of the cell'
      )
    ).toBe(true);
  });

  it('returns true when the marker is embedded in HTML', () => {
    expect(looksLikeCloze('<p>What is <b>{{c1::Paris}}</b>?</p>')).toBe(true);
  });

  it('returns false on plain Q/A text', () => {
    expect(looksLikeCloze('What is the capital of France?')).toBe(false);
  });

  it('returns false when only the opening braces are present', () => {
    expect(looksLikeCloze('Render {{ as braces}}')).toBe(false);
  });

  it('returns false when cloze marker has no digit', () => {
    expect(looksLikeCloze('{{c::Paris}} broken syntax')).toBe(false);
  });

  it('returns false on an empty string', () => {
    expect(looksLikeCloze('')).toBe(false);
  });
});

describe('transformBlankToCloze', () => {
  it('rewrites a single ___ blank with the back content as {{c1::...}}', () => {
    expect(
      transformBlankToCloze({
        front: 'The Norwegian word for hunting is ___.',
        back: 'jakt',
      })
    ).toEqual({
      front: 'The Norwegian word for hunting is {{c1::jakt}}.',
      back: '',
    });
  });

  it('only rewrites the first blank when the front has multiple', () => {
    expect(
      transformBlankToCloze({
        front: 'A ___ eats ___ for breakfast.',
        back: 'cat',
      })
    ).toEqual({
      front: 'A {{c1::cat}} eats ___ for breakfast.',
      back: '',
    });
  });

  it('leaves the card unchanged when front already uses canonical cloze syntax', () => {
    const card = {
      front: 'The capital of {{c1::France}} is Paris.',
      back: '',
    };
    expect(transformBlankToCloze(card)).toEqual(card);
  });

  it('leaves the card unchanged when there is no blank pattern in the front', () => {
    const card = { front: 'What is the capital of France?', back: 'Paris' };
    expect(transformBlankToCloze(card)).toEqual(card);
  });

  it('leaves the card unchanged when back is empty or whitespace-only', () => {
    const card = { front: 'A ___ is a furry pet.', back: '   ' };
    expect(transformBlankToCloze(card)).toEqual(card);
  });

  it('trims surrounding whitespace from the back content before substitution', () => {
    expect(
      transformBlankToCloze({
        front: 'Hjort means ___ in English.',
        back: '  deer  ',
      })
    ).toEqual({
      front: 'Hjort means {{c1::deer}} in English.',
      back: '',
    });
  });

  it('accepts 2-or-more underscores as a blank marker', () => {
    expect(
      transformBlankToCloze({
        front: 'Two underscores too: __',
        back: 'still works',
      })
    ).toEqual({
      front: 'Two underscores too: {{c1::still works}}',
      back: '',
    });
  });
});

describe('ChatDeckUseCase.execute monthly card limit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CustomExporter as unknown as jest.Mock).mockImplementation(() => ({
      configure: jest.fn(),
      save: jest.fn().mockResolvedValue(Buffer.from('apkg')),
    }));
  });

  function buildRepo(cardsUsed: number) {
    return {
      getCardUsage: jest
        .fn()
        .mockResolvedValue({ cards_used: cardsUsed, month_started_at: null }),
      incrementCardUsage: jest.fn().mockResolvedValue(0),
    } as unknown as UsersRepository;
  }

  const twoCards: ChatDeckCard[] = [
    { front: 'Q1', back: 'A1' },
    { front: 'Q2', back: 'A2' },
  ];

  it('throws MonthlyLimitError for a free user over the cap and does not build or record usage', async () => {
    const repo = buildRepo(99);
    const useCase = buildDeckUseCase(repo);

    await expect(
      useCase.execute({
        deckName: 'Over the cap',
        cards: twoCards,
        userId: 42,
        isPaying: false,
      })
    ).rejects.toBeInstanceOf(MonthlyLimitError);

    expect(CustomExporter).not.toHaveBeenCalled();
    expect(repo.incrementCardUsage).not.toHaveBeenCalled();
  });

  it('carries cards_used, limit, and reset_on on the thrown MonthlyLimitError', async () => {
    const repo = buildRepo(99);
    const useCase = buildDeckUseCase(repo);

    const error = await useCase
      .execute({
        deckName: 'Over the cap',
        cards: twoCards,
        userId: 42,
        isPaying: false,
      })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MonthlyLimitError);
    const limitError = error as MonthlyLimitError;
    expect(limitError.cards_used).toBe(99);
    expect(limitError.limit).toBe(100);
    expect(typeof limitError.reset_on).toBe('string');
  });

  it('builds and records the request card count for a free user under the cap', async () => {
    const repo = buildRepo(10);
    const useCase = buildDeckUseCase(repo);

    const buffer = await useCase.execute({
      deckName: 'Under the cap',
      cards: twoCards,
      userId: 42,
      isPaying: false,
    });

    expect(buffer).toEqual(Buffer.from('apkg'));
    expect(CustomExporter).toHaveBeenCalledTimes(1);
    expect(repo.incrementCardUsage).toHaveBeenCalledWith(42, 2);
  });

  it('builds and records usage for a paying user already over the cap', async () => {
    const repo = buildRepo(500);
    const useCase = buildDeckUseCase(repo);

    const buffer = await useCase.execute({
      deckName: 'Paying over the cap',
      cards: twoCards,
      userId: 42,
      isPaying: true,
    });

    expect(buffer).toEqual(Buffer.from('apkg'));
    expect(repo.getCardUsage).not.toHaveBeenCalled();
    expect(repo.incrementCardUsage).toHaveBeenCalledWith(42, 2);
  });
});
