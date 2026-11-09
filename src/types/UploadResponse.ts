import type Uploads from '../data_layer/public/Uploads';
import {
  type AiFileFailure,
  parseStoredAiFileFailures,
} from '../lib/claude/aiFileFailureReasons';

export interface UploadResponse {
  id: number;
  owner: number;
  key: string;
  filename: string | null;
  object_id: string | null;
  size_mb: number | null;
  created_at: string | null;
  source: string | null;
  dropped_image_count: number | null;
  image_drop_reason: string | null;
  empty_back_count: number | null;
  skipped_ai_files: AiFileFailure[];
}

export function toUploadResponse(row: Uploads): UploadResponse {
  return {
    id: row.id,
    owner: row.owner,
    key: row.key,
    filename: row.filename,
    object_id: row.object_id,
    size_mb: row.size_mb,
    created_at: row.created_at == null ? null : row.created_at.toISOString(),
    source: row.source,
    dropped_image_count: row.dropped_image_count,
    image_drop_reason: row.image_drop_reason,
    empty_back_count: row.empty_back_count,
    skipped_ai_files: parseStoredAiFileFailures(row.skipped_ai_files),
  };
}
