import type {
  CancellationCommentEntry,
  CancellationReasonCount,
} from '../../data_layer/CancellationFeedbackRepository';
import type { EmojiFeedbackCommentEntry } from '../../data_layer/EmojiFeedbackRepository';
import type { ConversionOutputStatsRow } from '../../data_layer/ConversionOutputStatsRepository';
import type { BehavioralDropoffCounts } from '../../data_layer/BehavioralDropoffRepository';
import type { ConversionErrorCount } from './ConversionMetricsService';
import {
  BehavioralDropoffSignalSource,
  CancellationSignalSource,
  CustomerSignalRow,
  CustomerSignalsService,
  EmojiSignalSource,
  EmptyBackSignalSource,
  FailedConversionSignalSource,
} from './CustomerSignalsService';

interface FakeSources {
  cancelReasons?: CancellationReasonCount[];
  cancelComments?: CancellationCommentEntry[];
  emojiComments?: EmojiFeedbackCommentEntry[];
  failureReasons?: ConversionErrorCount[];
  emptyBack?: ConversionOutputStatsRow[];
  dropoff?: BehavioralDropoffCounts;
  throwOn?:
    | 'cancellation'
    | 'emoji'
    | 'failedConversion'
    | 'emptyBack'
    | 'behavioralDropoff';
}

const noDropoff: BehavioralDropoffCounts = {
  signupsWithoutFirstUpload: 0,
  failedConversions: 0,
  zeroCardConversions: 0,
};

function buildService(sources: FakeSources): CustomerSignalsService {
  const cancellation: CancellationSignalSource = {
    countByReason: async () => {
      if (sources.throwOn === 'cancellation') throw new Error('cancel down');
      return sources.cancelReasons ?? [];
    },
    recentComments: async () => sources.cancelComments ?? [],
  };
  const emoji: EmojiSignalSource = {
    recentComments: async () => {
      if (sources.throwOn === 'emoji') throw new Error('emoji down');
      return sources.emojiComments ?? [];
    },
  };
  const failedConversion: FailedConversionSignalSource = {
    topFailureReasons7d: async () => {
      if (sources.throwOn === 'failedConversion') throw new Error('jobs down');
      return sources.failureReasons ?? [];
    },
  };
  const emptyBack: EmptyBackSignalSource = {
    list: async () => {
      if (sources.throwOn === 'emptyBack') throw new Error('stats down');
      return sources.emptyBack ?? [];
    },
  };
  const behavioralDropoff: BehavioralDropoffSignalSource = {
    counts: async () => {
      if (sources.throwOn === 'behavioralDropoff') {
        throw new Error('funnel down');
      }
      return sources.dropoff ?? noDropoff;
    },
  };
  return new CustomerSignalsService({
    cancellation,
    emoji,
    failedConversion,
    emptyBack,
    behavioralDropoff,
  });
}

const statsRow = (
  source: string,
  emptyBack: number
): ConversionOutputStatsRow => ({
  source,
  decks: 1,
  cards: 100,
  empty_back_cards: emptyBack,
  first_seen: '2026-01-01T00:00:00.000Z',
  last_seen: '2026-07-01T00:00:00.000Z',
});

const find = (
  signals: CustomerSignalRow[] | null,
  predicate: (row: CustomerSignalRow) => boolean
): CustomerSignalRow | undefined => signals?.find(predicate);

describe('CustomerSignalsService', () => {
  const since = new Date('2026-06-01T00:00:00.000Z');

  it('folds behavioral drop-offs in as first-class signals with buckets', async () => {
    const service = buildService({
      dropoff: {
        signupsWithoutFirstUpload: 40,
        failedConversions: 15,
        zeroCardConversions: 6,
      },
    });

    const result = await service.getSignals(since);

    const signup = find(
      result.signals,
      (row) => row.label === 'Signed up without starting an upload'
    );
    expect(signup).toMatchObject({
      source: 'behavioral_dropoff',
      count: 40,
      bucket: 'money-multiplier',
      stream: 'behavioral',
    });

    const failed = find(
      result.signals,
      (row) => row.label === 'Conversions that failed after an upload'
    );
    expect(failed).toMatchObject({
      source: 'behavioral_dropoff',
      count: 15,
      bucket: 'pain-killer',
    });

    const zeroCards = find(
      result.signals,
      (row) => row.label === 'Conversions that finished with 0 cards'
    );
    expect(zeroCards).toMatchObject({ count: 6, bucket: 'pain-killer' });
  });

  it('omits behavioral rows whose count is zero', async () => {
    const service = buildService({
      dropoff: {
        signupsWithoutFirstUpload: 0,
        failedConversions: 3,
        zeroCardConversions: 0,
      },
    });

    const result = await service.getSignals(since);
    const behavioral = result.signals?.filter(
      (row) => row.source === 'behavioral_dropoff'
    );

    expect(behavioral).toHaveLength(1);
    expect(behavioral?.[0].label).toBe(
      'Conversions that failed after an upload'
    );
  });

  it('scores convergence by distinct corroborating streams and sorts by it', async () => {
    const service = buildService({
      cancelReasons: [{ reason: 'too expensive', count: 3 }],
      cancelComments: [
        {
          reason: 'billing',
          comment: 'it is too expensive for a student budget',
          created_at: '2026-06-15T00:00:00.000Z',
        },
      ],
      emojiComments: [
        {
          rating: 1,
          comment: 'cards came out blank',
          page: 'Biochem',
          created_at: '2026-06-16T00:00:00.000Z',
        },
      ],
      emptyBack: [statsRow('notion', 30)],
      dropoff: {
        signupsWithoutFirstUpload: 100,
        failedConversions: 0,
        zeroCardConversions: 0,
      },
    });

    const result = await service.getSignals(since);

    const priceReason = find(
      result.signals,
      (row) => row.source === 'cancel_reason' && row.label === 'too expensive'
    );
    const priceComment = find(
      result.signals,
      (row) => row.source === 'cancel_comment'
    );
    expect(priceReason?.convergence).toBe(2);
    expect(priceComment?.convergence).toBe(2);

    const emptyBack = find(
      result.signals,
      (row) => row.source === 'empty_back'
    );
    const lowRating = find(
      result.signals,
      (row) => row.source === 'emoji_feedback'
    );
    expect(emptyBack?.convergence).toBe(2);
    expect(lowRating?.convergence).toBe(2);

    const signup = find(
      result.signals,
      (row) => row.label === 'Signed up without starting an upload'
    );
    expect(signup?.convergence).toBe(1);

    const convergences = (result.signals ?? []).map((row) => row.convergence);
    const sorted = [...convergences].sort((a, b) => b - a);
    expect(convergences).toEqual(sorted);
  });

  it('does not cluster a high emoji rating into the quality theme', async () => {
    const service = buildService({
      emptyBack: [statsRow('notion', 5)],
      emojiComments: [
        {
          rating: 5,
          comment: 'loved it',
          page: 'Biochem',
          created_at: '2026-06-16T00:00:00.000Z',
        },
      ],
    });

    const result = await service.getSignals(since);

    const highRating = find(
      result.signals,
      (row) => row.source === 'emoji_feedback'
    );
    expect(highRating?.convergence).toBe(1);
  });

  it('labels a low rating with the reason chip the user picked', async () => {
    const service = buildService({
      emojiComments: [
        {
          rating: 1,
          comment: '[images_missing] captions did not come through',
          page: 'downloads/deck_done',
          created_at: '2026-06-16T00:00:00.000Z',
        },
      ],
    });

    const result = await service.getSignals(since);

    const row = find(result.signals, (r) => r.source === 'emoji_feedback');
    expect(row?.label).toBe('Deck-ready rating 1 · images missing');
  });

  it('maps buckets for structured signals and truncates verbatim quotes', async () => {
    const longComment = 'x'.repeat(250);
    const service = buildService({
      failureReasons: [{ reason: 'Notion export unreadable', count: 12 }],
      emojiComments: [
        {
          rating: 2,
          comment: longComment,
          page: 'Biochem',
          created_at: '2026-06-20T00:00:00.000Z',
        },
      ],
    });

    const result = await service.getSignals(since);

    const failure = find(
      result.signals,
      (row) => row.source === 'failed_conversion'
    );
    expect(failure).toMatchObject({
      label: 'Notion export unreadable',
      count: 12,
      bucket: 'pain-killer',
    });

    const emojiComment = find(
      result.signals,
      (row) => row.source === 'emoji_feedback'
    );
    expect(emojiComment?.sampleQuote).toHaveLength(200);
    expect(emojiComment?.sampleQuote?.endsWith('…')).toBe(true);
  });

  it('drops free-text comments older than the window', async () => {
    const service = buildService({
      cancelComments: [
        {
          reason: 'too expensive',
          comment: 'old feedback',
          created_at: '2026-05-01T00:00:00.000Z',
        },
      ],
    });

    const result = await service.getSignals(since);

    expect(result.signals?.some((row) => row.source === 'cancel_comment')).toBe(
      false
    );
  });

  it('returns a null list and the error message when a source throws', async () => {
    const service = buildService({ throwOn: 'behavioralDropoff' });

    const result = await service.getSignals(since);

    expect(result.signals).toBeNull();
    expect(result.error).toBe('funnel down');
  });
});
