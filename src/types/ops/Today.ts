export type ScoreStatus = 'red' | 'amber' | 'green' | 'none';
export type ScoreLever = 'acquisition' | 'revenue' | 'retention' | 'health';
export type ScoreFormat = 'count' | 'percent';
export type TargetDirection = 'at_least' | 'at_most';

export interface ScoreRow {
  id: string;
  lever: ScoreLever;
  label: string;
  format: ScoreFormat;
  window_label: string;
  value: number | null;
  delta: number | null;
  delta_good: boolean | null;
  target: number | null;
  target_direction: TargetDirection | null;
  status: ScoreStatus;
  link: string;
}

export interface TodaySnapshotError {
  source: string;
  message: string;
}

export interface TodaySnapshotResponse {
  rows: ScoreRow[];
  as_of: string;
  cache_age_seconds: number;
  stale: boolean;
  errors: TodaySnapshotError[];
}
