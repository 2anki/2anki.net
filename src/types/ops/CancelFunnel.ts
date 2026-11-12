export interface CancelFunnelStages {
  cancel_started: number;
  cancelled: number;
}

export interface CancelFunnelResponse {
  stages: CancelFunnelStages | null;
  since: string;
  as_of: string;
  error?: string;
}
