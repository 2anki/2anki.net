export interface MindmapUserStorageEntry {
  user_id: string;
  bytes: number;
  object_count: number;
}

export interface MindmapStorageMetricsResponse {
  total_bytes: number;
  total_objects: number;
  top_users: MindmapUserStorageEntry[];
  measured_at: string;
}
