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

export interface CustomerSignalsResponse {
  signals: CustomerSignalRow[] | null;
  since: string;
  as_of: string;
  error?: string;
}
