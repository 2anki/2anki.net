export interface UploadFunnelStages {
  upload_started: number;
  conversion_succeeded: number;
  conversion_failed: number;
  deck_downloaded: number;
  paywall_shown: number;
  signup: number;
  paid: number;
}

export interface UploadFunnelOriginBreakdown {
  origin: string | null;
  stages: UploadFunnelStages;
  upload_to_download_rate_pct: number;
  download_to_signup_rate_pct: number;
  download_to_paid_rate_pct: number;
}

export interface UploadFunnelResponse {
  stages: UploadFunnelStages | null;
  by_origin: UploadFunnelOriginBreakdown[];
  upload_to_download_rate_pct: number;
  download_to_signup_rate_pct: number;
  download_to_paid_rate_pct: number;
  signup_reliable: boolean;
  since: string;
  as_of: string;
  error?: string;
}
