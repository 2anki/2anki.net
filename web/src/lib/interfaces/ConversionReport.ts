export type ConversionReportStage = 'block' | 'media' | 'card' | 'output';

export interface ConversionReportEntry {
  stage: ConversionReportStage;
  reason_code: string;
  human_reason: string;
  count: number;
}

export interface ConversionReport {
  summary: {
    blocks_seen: number;
    cards_created: number;
    blocks_skipped: number;
  };
  entries: ConversionReportEntry[];
  truncated?: boolean;
  omitted_entry_count?: number;
}
