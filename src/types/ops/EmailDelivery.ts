export interface EmailDeliveryCategory {
  category: string;
  delivered: number;
  bounce: number;
  dropped: number;
  blocked: number;
  deferred: number;
  spamreport: number;
  unsubscribe: number;
  failure_rate: number;
}

export interface EmailDeliveryMetricsResponse {
  by_category: EmailDeliveryCategory[];
}

export interface EmailDeliveryMetricsPayload extends EmailDeliveryMetricsResponse {
  window: string;
}
