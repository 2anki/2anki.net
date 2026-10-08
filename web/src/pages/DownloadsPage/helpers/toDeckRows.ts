import type JobResponse from '@server/types/JobResponse';
import UserUpload from '../../../lib/interfaces/UserUpload';
import { DropboxUpload, GoogleDriveUpload } from '../../../lib/backend';

export type DeckRow =
  | { source: 'notion'; kind: 'job'; job: JobResponse; sortKey: Date }
  | { source: 'upload'; kind: 'job'; job: JobResponse; sortKey: Date }
  | { source: 'mcp'; kind: 'job'; job: JobResponse; sortKey: Date }
  | {
      source: 'upload' | 'app';
      kind: 'file';
      upload: UserUpload;
      droppedImageCount: number;
      imageDropReason: string | null;
      sortKey: Date;
    }
  | { source: 'dropbox'; kind: 'dropbox'; upload: DropboxUpload; sortKey: Date }
  | {
      source: 'drive';
      kind: 'drive';
      upload: GoogleDriveUpload;
      sortKey: Date;
    };

const NOTION_TYPES = new Set(['page', 'database', 'conversion']);
const EPOCH = new Date(0);

function jobSource(
  type: string | null | undefined
): 'notion' | 'upload' | 'mcp' {
  if (type === 'mcp') return 'mcp';
  if (type != null && NOTION_TYPES.has(type)) return 'notion';
  return 'upload';
}

function uploadSource(source: string | null | undefined): 'upload' | 'app' {
  if (source === 'app') return 'app';
  return 'upload';
}

function toSortKey(value: string | Date | null | undefined): Date {
  if (value == null) return EPOCH;
  return new Date(value);
}

function buildSuppressedObjectIds(jobs: JobResponse[]): Set<string> {
  const ids = new Set<string>();
  for (const job of jobs) {
    const source = jobSource(job.type);
    const isGeneratedDoneWithKey =
      (source === 'notion' || source === 'mcp') &&
      job.status === 'done' &&
      job.download_key != null;
    if (isGeneratedDoneWithKey) ids.add(job.object_id);
  }
  return ids;
}

export function toDeckRows(
  jobs: JobResponse[],
  uploads: UserUpload[],
  dropboxUploads: DropboxUpload[],
  googleDriveUploads: GoogleDriveUpload[]
): DeckRow[] {
  const suppressedUploadObjectIds = buildSuppressedObjectIds(jobs);
  const rows: DeckRow[] = [];

  for (const job of jobs) {
    rows.push({
      source: jobSource(job.type),
      kind: 'job',
      job,
      sortKey: toSortKey(job.created_at),
    });
  }

  for (const upload of uploads) {
    if (
      upload.object_id != null &&
      suppressedUploadObjectIds.has(upload.object_id)
    )
      continue;
    rows.push({
      source: uploadSource(upload.source),
      kind: 'file',
      upload,
      droppedImageCount: upload.dropped_image_count ?? 0,
      imageDropReason: upload.image_drop_reason ?? null,
      sortKey: toSortKey(upload.created_at),
    });
  }

  for (const upload of dropboxUploads) {
    rows.push({
      source: 'dropbox',
      kind: 'dropbox',
      upload,
      sortKey: toSortKey(upload.created_at),
    });
  }

  for (const upload of googleDriveUploads) {
    rows.push({
      source: 'drive',
      kind: 'drive',
      upload,
      sortKey: toSortKey(upload.last_converted_at),
    });
  }

  rows.sort((a, b) => b.sortKey.getTime() - a.sortKey.getTime());

  return rows;
}
