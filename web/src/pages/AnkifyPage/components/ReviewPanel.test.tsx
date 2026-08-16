import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ReviewPanel, { CardFrame, DeckPicker } from './ReviewPanel';
import { Backend, ReviewQueueCard } from '../../../lib/backend/Backend';
import { AnkifyStats, AnkifyStatsDeck } from '../stats/types';

const trackMock = vi.fn();
vi.mock('../../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

const confettiMock = vi.fn();
vi.mock('canvas-confetti', () => ({
  default: (...args: unknown[]) => confettiMock(...args),
}));

const renderPanel = (backend: Backend) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReviewPanel backend={backend} />
    </QueryClientProvider>
  );
};

const statsWithDeck = (review: number): AnkifyStats => ({
  connected: true,
  reviewedToday: 0,
  reviewedThisYear: 0,
  currentStreak: 0,
  longestStreak: 0,
  reviewsByDay: [],
  decks: [
    {
      fullName: 'Notion Sync::Pharma',
      name: 'Pharma',
      depth: 1,
      new: 3,
      learning: 1,
      review,
      total: 120,
    },
  ],
});

const statsWithCounts = (counts: {
  review: number;
  learning: number;
  new: number;
}): AnkifyStats => ({
  connected: true,
  reviewedToday: 0,
  reviewedThisYear: 0,
  currentStreak: 0,
  longestStreak: 0,
  reviewsByDay: [],
  decks: [
    {
      fullName: 'Notion Sync::Pharma',
      name: 'Pharma',
      depth: 1,
      new: counts.new,
      learning: counts.learning,
      review: counts.review,
      total: 120,
    },
  ],
});

const cardById: Record<number, ReviewQueueCard> = {
  9001: {
    cardId: 9001,
    questionHtml: '<p>Q1</p>',
    answerHtml: '<p>A1</p>',
    css: '',
  },
  9002: {
    cardId: 9002,
    questionHtml: '<p>Q2</p>',
    answerHtml: '<p>A2</p>',
    css: '',
  },
};

const makeBackend = (overrides: Partial<Backend> = {}): Backend =>
  ({
    getAnkifyStats: vi.fn(async () => statsWithDeck(2)),
    getAnkifyReviewQueue: vi.fn(async () => ({
      connected: true as const,
      cardIds: [9001, 9002],
    })),
    getAnkifyReviewCard: vi.fn(async (cardId: number) => ({
      connected: true as const,
      card: cardById[cardId] ?? null,
    })),
    gradeAnkifyReviewCard: vi.fn(async () => {}),
    ...overrides,
  }) as unknown as Backend;

beforeEach(() => {
  trackMock.mockClear();
  confettiMock.mockClear();
  window.matchMedia = vi.fn(
    () => ({ matches: false }) as unknown as MediaQueryList
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReviewPanel', () => {
  test('runs front -> reveal -> grade -> next -> summary', async () => {
    const grade = vi.fn(async () => {});
    renderPanel(makeBackend({ gradeAnkifyReviewCard: grade }));

    const reviewButton = await screen.findByRole('button', { name: 'Review' });
    fireEvent.click(reviewButton);

    const showAnswer = await screen.findByRole('button', {
      name: 'Show answer',
    });
    expect(
      screen.queryByRole('button', { name: /Good/ })
    ).not.toBeInTheDocument();
    fireEvent.click(showAnswer);

    const good = await screen.findByRole('button', { name: /Good/ });
    fireEvent.click(good);

    await waitFor(() => expect(grade).toHaveBeenCalledWith(9001, 3));

    const showAnswer2 = await screen.findByRole('button', {
      name: 'Show answer',
    });
    fireEvent.click(showAnswer2);
    fireEvent.click(await screen.findByRole('button', { name: /Again/ }));

    await waitFor(() => expect(grade).toHaveBeenCalledWith(9002, 1));
    expect(await screen.findByText('2 cards. Done.')).toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledWith(
      'ankify_review_session_started',
      expect.anything()
    );
    expect(trackMock).toHaveBeenCalledWith(
      'ankify_review_completed',
      expect.objectContaining({ graded: 2 })
    );
  });

  test('fires confetti on a finished session and respects reduced motion', async () => {
    renderPanel(makeBackend());

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
    fireEvent.click(await screen.findByRole('button', { name: /Good/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
    fireEvent.click(await screen.findByRole('button', { name: /Good/ }));

    expect(await screen.findByText('2 cards. Done.')).toBeInTheDocument();
    await waitFor(() => expect(confettiMock).toHaveBeenCalledTimes(1));
  });

  test('skips confetti when prefers-reduced-motion is set', async () => {
    window.matchMedia = vi.fn(
      () => ({ matches: true }) as unknown as MediaQueryList
    );
    renderPanel(makeBackend());

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
    fireEvent.click(await screen.findByRole('button', { name: /Good/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
    fireEvent.click(await screen.findByRole('button', { name: /Good/ }));

    expect(await screen.findByText('2 cards. Done.')).toBeInTheDocument();
    expect(confettiMock).not.toHaveBeenCalled();
  });

  test('skips a card that has gone missing', async () => {
    const getAnkifyReviewCard = vi.fn(async (cardId: number) => {
      if (cardId === 9001) {
        return { connected: true as const, card: null };
      }
      return { connected: true as const, card: cardById[cardId] ?? null };
    });
    renderPanel(makeBackend({ getAnkifyReviewCard }));

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    const frame = (await screen.findByTitle(
      'Card preview'
    )) as HTMLIFrameElement;
    await waitFor(() => expect(frame.srcdoc).toContain('Q2'));
    expect(getAnkifyReviewCard).toHaveBeenCalledWith(9002);
  });

  test('exits a review session back to the deck picker', async () => {
    renderPanel(makeBackend());

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Show answer' });

    fireEvent.click(screen.getByRole('button', { name: 'Back to decks' }));

    expect(
      await screen.findByText(
        'Pick a deck to study its due and new cards without opening Anki.'
      )
    ).toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledWith(
      'ankify_review_session_exited',
      expect.objectContaining({ deck: 'Notion Sync::Pharma', graded: 0 })
    );
  });

  test('shows the all-caught-up state when no cards are due', async () => {
    renderPanel(
      makeBackend({
        getAnkifyStats: vi.fn(async () => statsWithDeck(5)),
        getAnkifyReviewQueue: vi.fn(async () => ({
          connected: true as const,
          cardIds: [],
        })),
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    expect(
      await screen.findByText(
        'Nothing to study in this deck right now — no due or new cards.'
      )
    ).toBeInTheDocument();
  });

  test('returns to the deck picker from the all-caught-up state', async () => {
    renderPanel(
      makeBackend({
        getAnkifyStats: vi.fn(async () => statsWithDeck(5)),
        getAnkifyReviewQueue: vi.fn(async () => ({
          connected: true as const,
          cardIds: [],
        })),
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    await screen.findByText(
      'Nothing to study in this deck right now — no due or new cards.'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to decks' }));

    expect(
      await screen.findByText(
        'Pick a deck to study its due and new cards without opening Anki.'
      )
    ).toBeInTheDocument();
  });

  test('shows the offline state with Try again when the queue reports offline', async () => {
    const getAnkifyReviewQueue = vi.fn(async () => ({
      connected: false as const,
      reason: 'offline' as const,
    }));
    renderPanel(makeBackend({ getAnkifyReviewQueue }));

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    expect(
      await screen.findByText(
        "Anki isn't connected. Open Anki on your computer and try again."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getAnkifyReviewQueue).toHaveBeenCalledTimes(2));
  });

  test('shows the error state with Try again when the queue reports error', async () => {
    const getAnkifyReviewQueue = vi.fn(async () => ({
      connected: false as const,
      reason: 'error' as const,
    }));
    renderPanel(makeBackend({ getAnkifyReviewQueue }));

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    expect(
      await screen.findByText(
        'Something broke while loading this deck. Try again in a moment.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getAnkifyReviewQueue).toHaveBeenCalledTimes(2));
  });

  test('shows the empty-decks state when stats has no decks', async () => {
    renderPanel(
      makeBackend({
        getAnkifyStats: vi.fn(async () => ({
          connected: true as const,
          reviewedToday: 0,
          reviewedThisYear: 0,
          currentStreak: 0,
          longestStreak: 0,
          reviewsByDay: [],
          decks: [],
        })),
      })
    );

    expect(
      await screen.findByText(
        'No decks to review yet. Sync a Notion page to start building cards.'
      )
    ).toBeInTheDocument();
  });

  test('disables the Review button for a deck with nothing to study', async () => {
    renderPanel(
      makeBackend({
        getAnkifyStats: vi.fn(async () =>
          statsWithCounts({ review: 0, learning: 0, new: 0 })
        ),
      })
    );

    const reviewButton = await screen.findByRole('button', { name: 'Review' });
    expect(reviewButton).toBeDisabled();
  });

  test('enables the Review button for a deck with only new cards', async () => {
    renderPanel(
      makeBackend({
        getAnkifyStats: vi.fn(async () =>
          statsWithCounts({ review: 0, learning: 0, new: 4 })
        ),
      })
    );

    const reviewButton = await screen.findByRole('button', { name: 'Review' });
    expect(reviewButton).toBeEnabled();
  });

  test('sends the full deck path to the review queue for a subdeck', async () => {
    const subdeckStats: AnkifyStats = {
      connected: true,
      reviewedToday: 0,
      reviewedThisYear: 0,
      currentStreak: 0,
      longestStreak: 0,
      reviewsByDay: [],
      decks: [
        {
          fullName: "Jlab's beginner course::Part 1: Listening comprehension",
          name: 'Part 1: Listening comprehension',
          depth: 1,
          new: 0,
          learning: 0,
          review: 5,
          total: 40,
        },
      ],
    };
    const getAnkifyReviewQueue = vi.fn(async () => ({
      connected: true as const,
      cardIds: [9001],
    }));
    renderPanel(
      makeBackend({
        getAnkifyStats: vi.fn(async () => subdeckStats),
        getAnkifyReviewQueue,
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    await waitFor(() =>
      expect(getAnkifyReviewQueue).toHaveBeenCalledWith(
        "Jlab's beginner course::Part 1: Listening comprehension"
      )
    );
  });

  test('shows aggregate counts on a parent and keeps it reviewable via a due child', async () => {
    const treeStats: AnkifyStats = {
      connected: true,
      reviewedToday: 0,
      reviewedThisYear: 0,
      currentStreak: 0,
      longestStreak: 0,
      reviewsByDay: [],
      decks: [
        {
          fullName: 'Spanish',
          name: 'Spanish',
          depth: 0,
          new: 1,
          learning: 0,
          review: 0,
          total: 10,
        },
        {
          fullName: 'Spanish::Verbs',
          name: 'Verbs',
          depth: 1,
          new: 2,
          learning: 3,
          review: 4,
          total: 20,
        },
      ],
    };
    renderPanel(makeBackend({ getAnkifyStats: vi.fn(async () => treeStats) }));

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    const parent = items[0];
    expect(parent).toHaveTextContent('Spanish');
    expect(parent).toHaveTextContent('4 due');
    expect(parent).toHaveTextContent('3 learning');
    expect(parent).toHaveTextContent('+3 new');
    const parentReview = parent.querySelector('button');
    expect(parentReview).not.toBeDisabled();
  });

  test('renders the card iframe with allow="autoplay"', async () => {
    renderPanel(makeBackend());

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    const frame = (await screen.findByTitle(
      'Card preview'
    )) as HTMLIFrameElement;
    expect(frame.getAttribute('allow')).toBe('autoplay');
  });

  test('wires first-audio autoplay into the front and post-reveal srcDoc', async () => {
    const audioCard: ReviewQueueCard = {
      cardId: 9001,
      questionHtml:
        '<p>Q</p><audio controls src="data:audio/mp3;base64,AA"></audio>',
      answerHtml:
        '<p>A</p><audio controls src="data:audio/mp3;base64,BB"></audio>',
      css: '',
    };
    renderPanel(
      makeBackend({
        getAnkifyReviewCard: vi.fn(async () => ({
          connected: true as const,
          card: audioCard,
        })),
        getAnkifyReviewQueue: vi.fn(async () => ({
          connected: true as const,
          cardIds: [9001],
        })),
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    const frame = (await screen.findByTitle(
      'Card preview'
    )) as HTMLIFrameElement;
    await waitFor(() => expect(frame.srcdoc).toContain('Q'));
    expect(frame.srcdoc).toContain("querySelector('audio')");
    expect(frame.srcdoc).toContain('.play().catch(');

    fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));

    await waitFor(() => expect(frame.srcdoc).toContain('A'));
    expect(frame.srcdoc).toContain("querySelector('audio')");
    expect(frame.srcdoc).toContain('.play().catch(');
  });

  test('collapses and expands a parent deck group', async () => {
    const treeStats: AnkifyStats = {
      connected: true,
      reviewedToday: 0,
      reviewedThisYear: 0,
      currentStreak: 0,
      longestStreak: 0,
      reviewsByDay: [],
      decks: [
        {
          fullName: 'Spanish',
          name: 'Spanish',
          depth: 0,
          new: 1,
          learning: 0,
          review: 2,
          total: 10,
        },
        {
          fullName: 'Spanish::Verbs',
          name: 'Verbs',
          depth: 1,
          new: 2,
          learning: 3,
          review: 4,
          total: 20,
        },
      ],
    };
    renderPanel(makeBackend({ getAnkifyStats: vi.fn(async () => treeStats) }));

    expect(await screen.findAllByRole('listitem')).toHaveLength(2);

    const collapse = screen.getByRole('button', { name: 'Collapse Spanish' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapse);

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    const expand = screen.getByRole('button', { name: 'Expand Spanish' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(expand);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Collapse Spanish' })
    ).toBeInTheDocument();
  });

  test('does not show a disclosure control on a leaf deck', async () => {
    renderPanel(makeBackend());

    await screen.findByRole('button', { name: 'Review' });
    expect(
      screen.queryByRole('button', { name: /^Collapse / })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Expand / })
    ).not.toBeInTheDocument();
  });

  test('shows the offline state when Anki is not connected', async () => {
    renderPanel(
      makeBackend({
        getAnkifyStats: vi.fn(async () => ({ connected: false as const })),
      })
    );

    expect(
      await screen.findByText("Anki isn't connected.")
    ).toBeInTheDocument();
  });

  test('enables Review when a deck has due-learning cards but nothing review-due', async () => {
    renderPanel(
      makeBackend({
        getAnkifyStats: vi.fn(async () =>
          statsWithCounts({ review: 0, learning: 4, new: 4 })
        ),
      })
    );

    const reviewButton = await screen.findByRole('button', { name: 'Review' });
    expect(reviewButton).not.toBeDisabled();
  });
});

describe('DeckPicker collapse persistence', () => {
  const decksWithChild: AnkifyStatsDeck[] = [
    {
      fullName: 'MS3',
      name: 'MS3',
      depth: 0,
      new: 0,
      learning: 0,
      review: 0,
      total: 0,
    },
    {
      fullName: 'MS3::Pharmacology',
      name: 'Pharmacology',
      depth: 1,
      new: 2,
      learning: 0,
      review: 3,
      total: 10,
    },
  ];

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('collapsing a deck persists across remounts', () => {
    const { unmount } = render(
      <DeckPicker decks={decksWithChild} onReview={vi.fn()} />
    );

    expect(screen.getByText('Pharmacology')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse MS3' }));
    expect(screen.queryByText('Pharmacology')).not.toBeInTheDocument();

    unmount();
    render(<DeckPicker decks={decksWithChild} onReview={vi.fn()} />);

    expect(screen.queryByText('Pharmacology')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand MS3' })
    ).toBeInTheDocument();
  });
});

describe('CardFrame message handling', () => {
  function frameHeight(container: HTMLElement): string {
    const iframe = container.querySelector('iframe');
    if (iframe == null) throw new Error('iframe missing');
    return iframe.style.height;
  }

  function sendHeight(
    container: HTMLElement,
    height: number,
    overrides: Partial<MessageEventInit> = {}
  ) {
    const iframe = container.querySelector('iframe');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'n2a-review-height', height },
          origin: 'null',
          source: iframe?.contentWindow ?? null,
          ...overrides,
        })
      );
    });
  }

  it('resizes to a height reported by its own sandboxed frame', () => {
    const { container } = render(<CardFrame srcDoc="<p>card</p>" />);
    sendHeight(container, 480);
    expect(frameHeight(container)).toBe('480px');
  });

  it('ignores a height message from a foreign origin', () => {
    const { container } = render(<CardFrame srcDoc="<p>card</p>" />);
    sendHeight(container, 480, { origin: 'https://evil.example' });
    expect(frameHeight(container)).toBe('128px');
  });

  it('ignores a height message whose source is not the frame', () => {
    const { container } = render(<CardFrame srcDoc="<p>card</p>" />);
    sendHeight(container, 480, { source: null });
    expect(frameHeight(container)).toBe('128px');
  });

  it('caps a hostile height so card content cannot blow up the layout', () => {
    const { container } = render(<CardFrame srcDoc="<p>card</p>" />);
    sendHeight(container, 10_000_000);
    expect(frameHeight(container)).toBe('4096px');
  });
});
