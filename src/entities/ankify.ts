export type AnkifyClientStatus = 'active' | 'inactive';

export interface AnkifySessionToken {
  id: number;
  ankify_client_id: number;
  owner: number;
  token_hash: string;
  expires_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface NewAnkifySessionToken {
  ankify_client_id: number;
  owner: number;
  token_hash: string;
  expires_at: Date;
}

export interface AnkifyClient {
  id: number;
  owner: number;
  container_id: string;
  container_name: string | null;
  anki_port: number;
  vnc_port: number;
  novnc_port: number;
  anki_connect_api_key: string | null;
  status: AnkifyClientStatus;
  created_at: Date;
  last_active_at: Date;
}

export interface NewAnkifyClient {
  owner: number;
  container_id: string;
  container_name: string | null;
  anki_port: number;
  vnc_port: number;
  novnc_port: number;
  anki_connect_api_key: string | null;
}

export type AnkifySyncMappingSourceType = 'apkg_guid' | 'notion_block';

export interface AnkifySyncMapping {
  id: number;
  ankify_client_id: number;
  source_id: string;
  source_type: AnkifySyncMappingSourceType;
  anki_note_id: number;
  deck_name: string;
  content_hash: string | null;
  last_synced_at: Date;
}

export interface NewAnkifySyncMapping {
  ankify_client_id: number;
  source_id: string;
  source_type: AnkifySyncMappingSourceType;
  anki_note_id: number;
  deck_name: string;
  content_hash?: string | null;
}

export interface AnkifyExportSchedule {
  id: number;
  owner: number;
  database_id: string;
  time_of_day: string;
  timezone: string;
  date_range_days: number | null;
  enabled: boolean;
  last_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertAnkifyExportSchedule {
  owner: number;
  database_id: string;
  time_of_day: string;
  timezone: string;
  date_range_days: number | null;
  enabled: boolean;
}

export type AnkifySyncLogKind =
  | 'dispatch'
  | 'export_review_data'
  | 'scheduled_export'
  | 'webhook'
  | 'reaper'
  | 'provision'
  | 'respin';

export type AnkifySyncLogStatus = 'success' | 'partial' | 'error' | 'info';

export interface AnkifySyncLog {
  id: number;
  owner: number;
  kind: AnkifySyncLogKind;
  status: AnkifySyncLogStatus;
  message: string;
  payload: unknown;
  created_at: Date;
}

export interface NewAnkifySyncLog {
  owner: number;
  kind: AnkifySyncLogKind;
  status: AnkifySyncLogStatus;
  message: string;
  payload?: unknown;
}

export type NotionObjectType = 'page' | 'database';

export interface AnkifyNotionSubscription {
  id: number;
  owner: number;
  ankify_client_id: number;
  notion_page_id: string;
  notion_page_title: string | null;
  notion_page_url: string | null;
  notion_page_icon: string | null;
  target_deck: string | null;
  notion_object_type?: NotionObjectType | null;
  enabled: boolean;
  last_polled_at: Date | null;
  last_synced_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertAnkifyNotionSubscription {
  owner: number;
  ankify_client_id: number;
  notion_page_id: string;
  notion_page_title?: string | null;
  notion_page_url?: string | null;
  notion_page_icon?: string | null;
  target_deck?: string | null;
  enabled: boolean;
}

export type AnkifyConflictKind =
  | 'both_edited'
  | 'anki_deleted'
  | 'notion_deleted';

export type AnkifyConflictStatus = 'pending' | 'resolved' | 'dismissed';

export type AnkifyConflictResolution =
  | 'keep_notion'
  | 'keep_anki'
  | 'dismissed'
  | null;

export interface AnkifySyncConflict {
  id: number;
  owner: number;
  ankify_client_id: number;
  subscription_id: number | null;
  source_id: string;
  anki_note_id: number;
  kind: AnkifyConflictKind;
  notion_last_edited_at: Date | null;
  anki_modified_at: number | null;
  notion_snapshot: unknown;
  anki_snapshot: unknown;
  status: AnkifyConflictStatus;
  resolution: AnkifyConflictResolution;
  created_at: Date;
  resolved_at: Date | null;
}

export interface NewAnkifySyncConflict {
  owner: number;
  ankify_client_id: number;
  subscription_id: number | null;
  source_id: string;
  anki_note_id: number;
  kind: AnkifyConflictKind;
  notion_last_edited_at: Date | null;
  anki_modified_at: number | null;
  notion_snapshot: unknown;
  anki_snapshot: unknown;
}
