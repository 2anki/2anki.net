import type {
  INotionTopLevelPagesRepository,
  NotionTopLevelPageRow,
} from '../../data_layer/NotionTopLevelPagesRepository';
import type {
  IUploadRepository,
  LastReconvertibleUpload,
} from '../../data_layer/UploadRespository';
import type { INotionRepository } from '../../data_layer/NotionRespository';

export type RecentSourceType = 'notion' | 'remote_upload';

export interface RecentSourceDto {
  id: string;
  title: string;
  type: RecentSourceType;
  updatedAt: string;
  convertUrl: string;
}

const RECENT_LIMIT = 3;

function toTime(value: Date | null): number {
  if (value == null) return 0;
  return new Date(value).getTime();
}

function notionToDto(row: NotionTopLevelPageRow): RecentSourceDto {
  const updatedAt = row.last_edited_time ?? row.cached_at;
  return {
    id: row.notion_page_id,
    title: row.title,
    type: 'notion',
    updatedAt: new Date(updatedAt).toISOString(),
    convertUrl: `/preview/${encodeURIComponent(row.notion_page_id)}`,
  };
}

function uploadToDto(upload: LastReconvertibleUpload): RecentSourceDto {
  return {
    id: upload.key,
    title: upload.filename,
    type: 'remote_upload',
    updatedAt: new Date(upload.created_at).toISOString(),
    convertUrl: `/preview/apkg/${encodeURIComponent(upload.key)}`,
  };
}

export class GetRecentSourcesUseCase {
  constructor(
    private readonly notionPages: INotionTopLevelPagesRepository,
    private readonly uploads: IUploadRepository,
    private readonly notionConnection: Pick<INotionRepository, 'getNotionData'>
  ) {}

  async execute(userId: number): Promise<RecentSourceDto[]> {
    const [pages, lastUpload, connection] = await Promise.all([
      this.notionPages.getRecentByOwner(userId, RECENT_LIMIT),
      this.uploads.getLastReconvertibleUpload(userId),
      this.notionConnection.getNotionData(userId),
    ]);

    // Cached pages outlive the connection: with no working Notion token every
    // one of these links would open a failure.
    const notionUsable =
      connection != null && connection.invalidated_at == null;
    const sources = notionUsable ? pages.map(notionToDto) : [];
    if (lastUpload != null) {
      sources.push(uploadToDto(lastUpload));
    }

    return sources
      .sort(
        (a, b) => toTime(new Date(b.updatedAt)) - toTime(new Date(a.updatedAt))
      )
      .slice(0, RECENT_LIMIT);
  }
}
