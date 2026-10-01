export interface UploadFunnelStages {
  upload_started: number;
  conversion_succeeded: number;
  conversion_failed: number;
  deck_downloaded: number;
  paywall_shown: number;
  signup: number;
  paid: number;
}

export interface UploadFunnelRates {
  upload_to_download_rate_pct: number;
  download_to_signup_rate_pct: number;
  download_to_paid_rate_pct: number;
}

export interface UploadFunnelOriginBreakdown extends UploadFunnelRates {
  origin: string | null;
  stages: UploadFunnelStages;
}

export interface ConversionFailedByReason {
  paywall: number;
  empty: number;
  technical: number;
}

export interface UploadFunnelResponse extends UploadFunnelRates {
  stages: UploadFunnelStages | null;
  by_origin: UploadFunnelOriginBreakdown[];
  conversion_failed_by_reason: ConversionFailedByReason;
  signup_reliable: boolean;
  since: string;
  as_of: string;
  error?: string;
}
