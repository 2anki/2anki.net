import path from 'path';
import ApkgPreviewService from '../../services/ApkgPreviewService/ApkgPreviewService';
import ApkgToNotionBlocksService, {
  DeckPage,
  buildTruncationNoticeBlocks,
} from '../../services/ApkgToNotionBlocksService';
import { APKG_IMPORT_NOTE_CAP_PAID } from '../../lib/apkg/importLimits';
import NotionAPIWrapper from '../../services/NotionService/NotionAPIWrapper';
import JobRepository from '../../data_layer/JobRepository';
import { BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints';
import { APIErrorCode, APIResponseError } from '@notionhq/client';

const BATCH_SIZE = 50;
const THROTTLE_MS = 350;

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
]);

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SQLITE_ERROR_CODES = new Set([
  'SQLITE_NOTADB',
  'SQLITE_CORRUPT',
  'SQLITE_CANTOPEN',
]);

const NOTION_OUTAGE_MESSAGE =
  'Notion is having issues. Try again in a few minutes.';

const NOTION_ERROR_MESSAGES: Partial<Record<APIErrorCode, string>> = {
  [APIErrorCode.Unauthorized]:
    'Notion sign-in expired. Reconnect Notion and try again.',
  [APIErrorCode.RestrictedResource]:
    "2anki can't write to this Notion page. Share it with the 2anki integration.",
  [APIErrorCode.ObjectNotFound]:
    'The Notion page is gone. Pick a different destination page.',
  [APIErrorCode.RateLimited]:
    'Notion is rate-limiting this account. Try again in a minute.',
  [APIErrorCode.InternalServerError]: NOTION_OUTAGE_MESSAGE,
  [APIErrorCode.ServiceUnavailable]: NOTION_OUTAGE_MESSAGE,
  [APIErrorCode.GatewayTimeout]: NOTION_OUTAGE_MESSAGE,
};

function resolveNotionFailureMessage(error: APIResponseError): string | null {
  if (
    error.code === APIErrorCode.ValidationError &&
    error.message.includes('archived ancestor')
  ) {
    return 'The Notion page you picked is in the trash. Restore it in Notion or pick a different destination page.';
  }
  return NOTION_ERROR_MESSAGES[error.code] ?? null;
}

function resolveFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('Upgrade')) {
    return error.message;
  }
  if (error instanceof APIResponseError) {
    const notionMessage = resolveNotionFailureMessage(error);
    if (notionMessage != null) return notionMessage;
  }
  const errorCode = (error as { code?: string })?.code;
  if (typeof errorCode === 'string' && SQLITE_ERROR_CODES.has(errorCode)) {
    return "Couldn't read this .apkg file. Export it again from Anki.";
  }
  return 'Import failed. Please try again or contact support.';
}

export default class ImportApkgToNotionUseCase {
  constructor(
    private readonly previewService: ApkgPreviewService,
    private readonly blocksService: ApkgToNotionBlocksService,
    private readonly jobRepository: JobRepository
  ) {}

  async execute(
    fileBuffer: Buffer,
    parentPageId: string,
    owner: string,
    notionApi: NotionAPIWrapper,
    jobId: string,
    options: { isPaying?: boolean; maxNotes: number }
  ): Promise<void> {
    const maxNotes = options.maxNotes;
    try {
      const cacheKey = `import:${owner}:${Date.now()}`;
      const parsed = await this.previewService.parse(cacheKey, fileBuffer);

      const result = this.blocksService.transform(
        parsed.collection,
        new Map(),
        maxNotes
      );

      let mediaUrlMap = new Map<string, string>();
      if (parsed.mediaMap.size > 0) {
        try {
          await this.jobRepository.updateJobStatus(
            jobId,
            owner,
            'processing',
            `uploading images`
          );
          mediaUrlMap = await this.uploadMediaToNotion(
            parsed.mediaMap,
            parsed.mediaEntries,
            notionApi,
            jobId,
            owner
          );
          result.deckPages = this.blocksService.transform(
            parsed.collection,
            mediaUrlMap,
            maxNotes
          ).deckPages;
        } catch (uploadError) {
          console.error(
            `[apkg-import] job=${jobId} media upload failed, continuing without images:`,
            uploadError
          );
        }
      }

      if (result.truncated && result.deckPages.length > 0) {
        result.deckPages[0].children.unshift(
          ...buildTruncationNoticeBlocks({
            importedNotes: result.importedNotes,
            totalNotes: result.totalNotes,
            isPaying: options.isPaying ?? false,
            paidCap: APKG_IMPORT_NOTE_CAP_PAID,
          })
        );
      }

      await this.jobRepository.updateJobStatus(
        jobId,
        owner,
        'processing',
        `0/${result.importedNotes} notes`
      );

      let imported = 0;

      for (const deckPage of result.deckPages) {
        imported = await this.writeDeckPage(
          notionApi,
          deckPage,
          parentPageId,
          jobId,
          owner,
          imported,
          result.importedNotes
        );
      }

      const pageResponse = await notionApi.getPage(parentPageId);
      const notionUrl =
        pageResponse && 'url' in pageResponse
          ? ((pageResponse as { url?: string }).url ?? null)
          : null;

      await this.jobRepository.updateJobStatus(
        jobId,
        owner,
        'done',
        JSON.stringify({
          imported: result.importedNotes,
          total_notes: result.totalNotes,
          truncated: result.truncated,
          note_cap: maxNotes,
          notion_page_url: notionUrl,
        })
      );
    } catch (error) {
      console.error(`[apkg-import] job=${jobId} failed:`, error);
      await this.jobRepository
        .updateJobStatus(jobId, owner, 'failed', resolveFailureMessage(error))
        .catch(() => {});
    }
  }

  private async uploadMediaToNotion(
    mediaMap: Map<string, string>,
    mediaEntries: Map<string, Buffer>,
    notionApi: NotionAPIWrapper,
    jobId: string,
    owner: string
  ): Promise<Map<string, string>> {
    const idMap = new Map<string, string>();

    const imageEntries = [...mediaMap.entries()].filter(([name, idx]) => {
      const buf = mediaEntries.get(idx);
      const ext = path.extname(name).toLowerCase();
      return buf != null && IMAGE_EXTENSIONS.has(ext);
    });
    const totalImages = imageEntries.length;
    let uploaded = 0;

    for (const [originalName, archiveIndex] of imageEntries) {
      const buffer = mediaEntries.get(archiveIndex)!;
      const ext = path.extname(originalName).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

      try {
        const fileUploadId = await notionApi.uploadFile(
          originalName,
          contentType,
          buffer
        );
        idMap.set(originalName, fileUploadId);
        uploaded++;
        await this.jobRepository.updateJobStatus(
          jobId,
          owner,
          'processing',
          `uploading images ${uploaded}/${totalImages}`
        );
        await sleep(THROTTLE_MS);
      } catch (err) {
        console.error(`[apkg-import] failed to upload ${originalName}:`, err);
      }
    }

    return idMap;
  }

  private async writeDeckPage(
    notionApi: NotionAPIWrapper,
    deckPage: DeckPage,
    parentId: string,
    jobId: string,
    owner: string,
    imported: number,
    totalNotes: number
  ): Promise<number> {
    const page = await notionApi.createPage(parentId, deckPage.title);
    await sleep(THROTTLE_MS);

    const blocks = deckPage.children as unknown as BlockObjectRequest[];
    let currentImported = imported;

    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
      const batch = blocks.slice(i, i + BATCH_SIZE);
      await notionApi.appendBlocks(page.id, batch);
      currentImported += batch.length;

      await this.jobRepository.updateJobStatus(
        jobId,
        owner,
        'processing',
        `${currentImported}/${totalNotes} notes`
      );

      await sleep(THROTTLE_MS);
    }

    for (const subDeck of deckPage.subDecks) {
      currentImported = await this.writeDeckPage(
        notionApi,
        subDeck,
        page.id,
        jobId,
        owner,
        currentImported,
        totalNotes
      );
    }

    return currentImported;
  }
}
