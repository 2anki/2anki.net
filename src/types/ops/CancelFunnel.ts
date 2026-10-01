export interface CancelFunnelStages {
  cancel_started: number;
  pause_offered: number;
  paused: number;
  cancelled: number;
  pause_offer_declined: number;
}

export interface CancelFunnelResponse {
  stages: CancelFunnelStages | null;
  save_rate_pct: number;
  offer_reach_pct: number;
  since: string;
  as_of: string;
  error?: string;
}
