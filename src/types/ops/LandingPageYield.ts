export interface LandingPageYieldEntry {
  origin: string | null;
  signups: number;
  subscription_conversions: number;
  pass_conversions: number;
  paid_conversion_rate_pct: number;
}

export interface LandingPageYieldResponse {
  pages: LandingPageYieldEntry[] | null;
  since: string;
  as_of: string;
  error?: string;
}
