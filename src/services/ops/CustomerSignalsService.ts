import type {
  CancellationCommentEntry,
  CancellationReasonCount,
} from '../../data_layer/CancellationFeedbackRepository';
import type { EmojiFeedbackCommentEntry } from '../../data_layer/EmojiFeedbackRepository';
import type { ConversionOutputStatsRow } from '../../data_layer/ConversionOutputStatsRepository';
import type { BehavioralDropoffCounts } from '../../data_layer/BehavioralDropoffRepository';
import type { ConversionErrorCount } from './ConversionMetricsService';

export type CustomerSignalSource =
  | 'cancel_reason'
  | 'cancel_comment'
  | 'emoji_feedback'
  | 'failed_conversion'
  | 'empty_back'
  | 'behavioral_dropoff';

export type CustomerSignalBucket =
  | 'pain-killer'
  | 'money-multiplier'
  | 'unknown';

export type CustomerSignalStream = 'said' | 'behavioral' | 'revenue';

export interface CustomerSignalRow {
  source: CustomerSignalSource;
  label: string;
  count: number;
  bucket: CustomerSignalBucket;
  stream: CustomerSignalStream;
  convergence: number;
  sampleQuote?: string;
}

type BaseSignalRow = Omit<CustomerSignalRow, 'stream' | 'convergence'>;

export interface CustomerSignalsResponse {
  signals: CustomerSignalRow[] | null;
  since: string;
  as_of: string;
  error?: string;
}

export interface CancellationSignalSource {
  countByReason(since: Date): Promise<CancellationReasonCount[]>;
  recentComments(limit: number): Promise<CancellationCommentEntry[]>;
}

export interface EmojiSignalSource {
  recentComments(limit: number): Promise<EmojiFeedbackCommentEntry[]>;
}

export interface FailedConversionSignalSource {
  topFailureReasons7d(since: Date): Promise<ConversionErrorCount[]>;
}

export interface EmptyBackSignalSource {
  list(): Promise<ConversionOutputStatsRow[]>;
}

export interface BehavioralDropoffSignalSource {
  counts(since: Date): Promise<BehavioralDropoffCounts>;
}

interface CustomerSignalsServiceDeps {
  cancellation: CancellationSignalSource;
  emoji: EmojiSignalSource;
  failedConversion: FailedConversionSignalSource;
  emptyBack: EmptyBackSignalSource;
  behavioralDropoff: BehavioralDropoffSignalSource;
}

const SAMPLE_LIMIT = 10;
const COMMENT_FETCH_LIMIT = 100;
const QUOTE_MAX_LENGTH = 200;
const ELLIPSIS = '…';

const STREAM_BY_SOURCE: Record<CustomerSignalSource, CustomerSignalStream> = {
  cancel_reason: 'revenue',
  cancel_comment: 'said',
  emoji_feedback: 'said',
  failed_conversion: 'behavioral',
  empty_back: 'behavioral',
  behavioral_dropoff: 'behavioral',
};

const PRICE_PATTERN = /expensive|afford|\bcost|\bprice|cheap|budget/;
const LIFECYCLE_PATTERN =
  /finish|no longer|don'?t use|not using|not enough|\benough\b|done with|complet/;
const QUALITY_PATTERN =
  /\bcard|broken|blank|empty back|format|quality|wrong|render|missing/;

function truncateQuote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= QUOTE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, QUOTE_MAX_LENGTH - 1).trimEnd()}${ELLIPSIS}`;
}

function withinWindow(createdAt: string, since: Date): boolean {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() >= since.getTime();
}

function emojiRating(label: string): number | null {
  const match = /rating\s+(\d+)/i.exec(label);
  return match ? Number(match[1]) : null;
}

function uniqueTheme(row: BaseSignalRow): string {
  return `other:${row.source}:${row.label}`;
}

function classifyTheme(row: BaseSignalRow): string {
  if (row.source === 'failed_conversion' || row.source === 'empty_back') {
    return 'conversion-quality';
  }

  if (row.source === 'behavioral_dropoff') {
    return row.label.toLowerCase().includes('upload')
      ? 'activation'
      : 'conversion-quality';
  }

  if (row.source === 'emoji_feedback') {
    const rating = emojiRating(row.label);
    return rating != null && rating <= 2
      ? 'conversion-quality'
      : uniqueTheme(row);
  }

  const text = `${row.label} ${row.sampleQuote ?? ''}`.toLowerCase();
  if (PRICE_PATTERN.test(text)) return 'price';
  if (LIFECYCLE_PATTERN.test(text)) return 'lifecycle';
  if (QUALITY_PATTERN.test(text)) return 'conversion-quality';

  return uniqueTheme(row);
}

function enrichWithConvergence(base: BaseSignalRow[]): CustomerSignalRow[] {
  const themes = base.map(classifyTheme);
  const streamsByTheme = new Map<string, Set<CustomerSignalStream>>();

  base.forEach((row, index) => {
    const theme = themes[index];
    const streams = streamsByTheme.get(theme) ?? new Set();
    streams.add(STREAM_BY_SOURCE[row.source]);
    streamsByTheme.set(theme, streams);
  });

  return base.map((row, index) => ({
    ...row,
    stream: STREAM_BY_SOURCE[row.source],
    convergence: streamsByTheme.get(themes[index])?.size ?? 1,
  }));
}

export class CustomerSignalsService {
  private readonly cancellation: CancellationSignalSource;
  private readonly emoji: EmojiSignalSource;
  private readonly failedConversion: FailedConversionSignalSource;
  private readonly emptyBack: EmptyBackSignalSource;
  private readonly behavioralDropoff: BehavioralDropoffSignalSource;

  constructor(deps: CustomerSignalsServiceDeps) {
    this.cancellation = deps.cancellation;
    this.emoji = deps.emoji;
    this.failedConversion = deps.failedConversion;
    this.emptyBack = deps.emptyBack;
    this.behavioralDropoff = deps.behavioralDropoff;
  }

  async getSignals(since: Date): Promise<CustomerSignalsResponse> {
    const as_of = new Date().toISOString();
    const sinceStr = since.toISOString();

    try {
      const base = await this.collectRows(since);
      const signals = enrichWithConvergence(base).sort(
        (a, b) => b.convergence - a.convergence || b.count - a.count
      );
      return { signals, since: sinceStr, as_of };
    } catch (err) {
      return {
        signals: null,
        since: sinceStr,
        as_of,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async collectRows(since: Date): Promise<BaseSignalRow[]> {
    const [
      cancelReasons,
      cancelComments,
      emojiComments,
      failureReasons,
      emptyBackStats,
      dropoffCounts,
    ] = await Promise.all([
      this.cancellation.countByReason(since),
      this.cancellation.recentComments(COMMENT_FETCH_LIMIT),
      this.emoji.recentComments(COMMENT_FETCH_LIMIT),
      this.failedConversion.topFailureReasons7d(since),
      this.emptyBack.list(),
      this.behavioralDropoff.counts(since),
    ]);

    return [
      ...toCancelReasonRows(cancelReasons),
      ...toFailedConversionRows(failureReasons),
      ...toEmptyBackRows(emptyBackStats),
      ...toBehavioralDropoffRows(dropoffCounts),
      ...toCancelCommentRows(cancelComments, since),
      ...toEmojiCommentRows(emojiComments, since),
    ];
  }
}

function toCancelReasonRows(
  reasons: CancellationReasonCount[]
): BaseSignalRow[] {
  return reasons.map((row) => ({
    source: 'cancel_reason' as const,
    label: row.reason,
    count: row.count,
    bucket: 'unknown' as const,
  }));
}

function toFailedConversionRows(
  reasons: ConversionErrorCount[]
): BaseSignalRow[] {
  return reasons.map((row) => ({
    source: 'failed_conversion' as const,
    label: row.reason,
    count: row.count,
    bucket: 'pain-killer' as const,
  }));
}

function toEmptyBackRows(stats: ConversionOutputStatsRow[]): BaseSignalRow[] {
  const total = stats.reduce((sum, row) => sum + row.empty_back_cards, 0);
  if (total <= 0) return [];
  return [
    {
      source: 'empty_back' as const,
      label: 'Cards generated with an empty back (all-time)',
      count: total,
      bucket: 'pain-killer' as const,
    },
  ];
}

function toBehavioralDropoffRows(
  counts: BehavioralDropoffCounts
): BaseSignalRow[] {
  const rows: BaseSignalRow[] = [];

  if (counts.signupsWithoutFirstUpload > 0) {
    rows.push({
      source: 'behavioral_dropoff',
      label: 'Signed up without starting an upload',
      count: counts.signupsWithoutFirstUpload,
      bucket: 'money-multiplier',
    });
  }

  if (counts.failedConversions > 0) {
    rows.push({
      source: 'behavioral_dropoff',
      label: 'Conversions that failed after an upload',
      count: counts.failedConversions,
      bucket: 'pain-killer',
    });
  }

  if (counts.zeroCardConversions > 0) {
    rows.push({
      source: 'behavioral_dropoff',
      label: 'Conversions that finished with 0 cards',
      count: counts.zeroCardConversions,
      bucket: 'pain-killer',
    });
  }

  return rows;
}

function toCancelCommentRows(
  comments: CancellationCommentEntry[],
  since: Date
): BaseSignalRow[] {
  return comments
    .filter((row) => withinWindow(row.created_at, since))
    .slice(0, SAMPLE_LIMIT)
    .map((row) => ({
      source: 'cancel_comment' as const,
      label: row.reason,
      count: 1,
      bucket: 'unknown' as const,
      sampleQuote: truncateQuote(row.comment),
    }));
}

const REASON_TAG = /^\[([a-z_]+)\]\s*/;

function emojiRowLabel(row: EmojiFeedbackCommentEntry): string {
  const base = `Deck-ready rating ${row.rating}`;
  const tag = REASON_TAG.exec(row.comment)?.[1];
  return tag == null ? base : `${base} · ${tag.replaceAll('_', ' ')}`;
}

function toEmojiCommentRows(
  comments: EmojiFeedbackCommentEntry[],
  since: Date
): BaseSignalRow[] {
  return comments
    .filter((row) => withinWindow(row.created_at, since))
    .slice(0, SAMPLE_LIMIT)
    .map((row) => ({
      source: 'emoji_feedback' as const,
      label: emojiRowLabel(row),
      count: 1,
      bucket: 'unknown' as const,
      sampleQuote: truncateQuote(row.comment),
    }));
}
