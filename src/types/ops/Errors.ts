export type ResolutionStatus = 'unresolved' | 'resolved' | 'all';

export interface ErrorGroupRow {
  message_hash: string;
  message: string;
  stack: string | null;
  url: string | null;
  release: string | null;
  source: string;
  user_id: number | null;
  user_agent: string | null;
  first_seen: string;
  last_seen: string;
  occurrences: number;
  resolved: boolean;
  resolved_at: string | null;
}

export interface ErrorGroupsResponse {
  groups: ErrorGroupRow[];
  totalGroups: number;
}
