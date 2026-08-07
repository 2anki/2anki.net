import { Request, Response } from 'express';
import { APIResponseError } from '@notionhq/client';
import path from 'path';
import { randomUUID } from 'crypto';
import StorageHandler from '../lib/storage/StorageHandler';
import DownloadService from '../services/DownloadService';
import ApkgPreviewService from '../services/ApkgPreviewService/ApkgPreviewService';
import ApkgToNotionBlocksService from '../services/ApkgToNotionBlocksService';
import PdfRenderService from '../services/PdfRenderService';
import ExportApkgToPdfUseCase, {
  CardLimitExceededError,
  DEFAULT_PDF_OPTIONS,
  type Margins,
  type Orientation,
  type PaperSize,
  type PdfOptions,
} from '../usecases/apkg/ExportApkgToPdfUseCase';
import ExportApkgToCsvUseCase, {
  CardLimitExceededError as CsvCardLimitExceededError,
  CSV_ANONYMOUS_NOTE_LIMIT,
  CSV_FREE_NOTE_LIMIT,
  EmptyDeckError as CsvEmptyDeckError,
} from '../usecases/apkg/ExportApkgToCsvUseCase';
import ImportApkgToNotionUseCase from '../usecases/apkg/ImportApkgToNotionUseCase';
import PackEditedApkgUseCase from '../usecases/apkg/PackEditedApkgUseCase';
import ResolveImportParentPageUseCase from '../usecases/apkg/ResolveImportParentPageUseCase';
import NoNotionPagesError from '../usecases/apkg/NoNotionPagesError';
import { CardEdit } from '../services/ApkgPreviewService/applyEditsToCards';
import { ApkgTooLargeError } from '../services/ApkgPreviewService/extractApkg';
import { NotionService } from '../services/NotionService/NotionService';
import JobRepository from '../data_layer/JobRepository';
import sendErrorResponse from '../lib/sendErrorResponse';
import { isPaying } from '../lib/isPaying';
import { getApkgImportNoteCap } from '../lib/apkg/importLimits';
import { buildContentDisposition } from '../lib/buildContentDisposition';
import { getSafeFilename } from '../lib/getSafeFilename';
import { track } from '../services/events/track';

async function tryUnlink(filePath: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.unlink(filePath).catch(() => {});
}

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

function guessContentType(name: string): string {
  const ext = path.extname(name).replace(/^\./, '').toLowerCase();
  return MEDIA_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function clampPageSize(input: unknown): number {
  const raw = typeof input === 'string' ? input : '';
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function clampCursor(input: unknown): number {
  const raw = typeof input === 'string' ? input : '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isApkg(key: string): boolean {
  return /\.apkg$/i.test(key);
}

const BACKGROUND_COLOR_REGEX = /^#[0-9a-f]{6}$/i;
const ALLOWED_PAPER_SIZES: PaperSize[] = ['A4', 'Letter', 'Legal'];
const ALLOWED_ORIENTATIONS: Orientation[] = ['portrait', 'landscape'];
const ALLOWED_MARGINS: Margins[] = ['narrow', 'normal', 'wide'];

export function parsePdfOptions(
  body: Record<string, unknown>
): PdfOptions | null {
  const rawColor = body.backgroundColor;
  if (typeof rawColor === 'string' && !BACKGROUND_COLOR_REGEX.test(rawColor)) {
    return null;
  }
  const backgroundColor =
    typeof rawColor === 'string' && BACKGROUND_COLOR_REGEX.test(rawColor)
      ? rawColor
      : DEFAULT_PDF_OPTIONS.backgroundColor;

  const rawPaper = body.paperSize;
  const paperSize: PaperSize =
    typeof rawPaper === 'string' &&
    (ALLOWED_PAPER_SIZES as string[]).includes(rawPaper)
      ? (rawPaper as PaperSize)
      : DEFAULT_PDF_OPTIONS.paperSize;

  const rawOrientation = body.orientation;
  const orientation: Orientation =
    typeof rawOrientation === 'string' &&
    (ALLOWED_ORIENTATIONS as string[]).includes(rawOrientation)
      ? (rawOrientation as Orientation)
      : DEFAULT_PDF_OPTIONS.orientation;

  const rawMargins = body.margins;
  const margins: Margins =
    typeof rawMargins === 'string' &&
    (ALLOWED_MARGINS as string[]).includes(rawMargins)
      ? (rawMargins as Margins)
      : DEFAULT_PDF_OPTIONS.margins;

  return { backgroundColor, paperSize, orientation, margins };
}

class ApkgController {
  constructor(
    private readonly downloadService: DownloadService,
    private readonly previewService: ApkgPreviewService,
    private readonly pdfRenderService: PdfRenderService = new PdfRenderService(),
    private readonly notionService?: NotionService,
    private readonly jobRepository?: JobRepository
  ) {}

  private async loadForKey(req: Request, res: Response) {
    const { key } = req.params;
    if (!key || !isApkg(key)) {
      res.status(400).json({ message: 'Not an .apkg upload.' });
      return null;
    }
    const { owner } = res.locals;
    const storage = new StorageHandler();
    const body = await this.downloadService.getFileBody(owner, key, storage);
    if (!body) {
      res.status(404).json({ message: 'Upload not found.' });
      return null;
    }
    const cacheKey = `${owner}:${key}`;
    return this.previewService.parse(cacheKey, body as Buffer);
  }

  async getMeta(req: Request, res: Response) {
    try {
      const parsed = await this.loadForKey(req, res);
      if (!parsed) return;
      res.json(this.previewService.getMeta(parsed));
    } catch (error) {
      if (sendApkgTooLarge(res, error)) return;
      if (this.downloadService.isMissingDownloadError(error)) {
        res.status(404).json({ message: 'Upload is no longer available.' });
        return;
      }
      console.info('APKG preview meta failed');
      console.error(error);
      sendErrorResponse(error, res);
    }
  }

  async getCards(req: Request, res: Response) {
    try {
      const parsed = await this.loadForKey(req, res);
      if (!parsed) return;
      const cursor = clampCursor(req.query.cursor);
      const pageSize = clampPageSize(req.query.page_size);
      const deckId = parseDeckId(req.query.deck_id);
      const mediaBaseUrl = `/api/apkg/${encodeURIComponent(
        req.params.key
      )}/media/`;
      res.json(
        this.previewService.getCardsPage(
          parsed,
          cursor,
          pageSize,
          mediaBaseUrl,
          deckId
        )
      );
    } catch (error) {
      if (sendApkgTooLarge(res, error)) return;
      if (this.downloadService.isMissingDownloadError(error)) {
        res.status(404).json({ message: 'Upload is no longer available.' });
        return;
      }
      console.info('APKG preview cards failed');
      console.error(error);
      sendErrorResponse(error, res);
    }
  }

  async getMedia(req: Request, res: Response) {
    try {
      const parsed = await this.loadForKey(req, res);
      if (!parsed) return;
      const { name } = req.params;
      if (!name) {
        res.status(400).json({ message: 'Missing media name.' });
        return;
      }
      const buffer = this.previewService.getMediaEntry(parsed, name);
      if (!buffer) {
        res.status(404).send();
        return;
      }
      res.setHeader('Content-Type', guessContentType(name));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(buffer);
    } catch (error) {
      if (sendApkgTooLarge(res, error)) return;
      if (this.downloadService.isMissingDownloadError(error)) {
        res.status(404).send();
        return;
      }
      console.info('APKG preview media failed');
      console.error(error);
      sendErrorResponse(error, res);
    }
  }

  async exportPdf(req: Request, res: Response) {
    try {
      const file = req.file;
      if (file == null) {
        res.status(400).json({ message: 'No file uploaded.' });
        return;
      }
      if (!isApkg(file.originalname)) {
        res.status(400).json({ message: 'File must be an .apkg file.' });
        return;
      }
      const pdfOptions = parsePdfOptions(req.body as Record<string, unknown>);
      if (pdfOptions == null) {
        res.status(400).json({
          message:
            'Invalid background color. Use a six-digit hex value like #ffffff.',
        });
        return;
      }
      const ownerId =
        typeof res.locals.owner === 'number' ? res.locals.owner : null;
      track('pdf_print_options_used', {
        userId: ownerId,
        props: {
          backgroundColor:
            pdfOptions.backgroundColor !== DEFAULT_PDF_OPTIONS.backgroundColor,
          paperSize: pdfOptions.paperSize !== DEFAULT_PDF_OPTIONS.paperSize,
          orientation:
            pdfOptions.orientation !== DEFAULT_PDF_OPTIONS.orientation,
          margins: pdfOptions.margins !== DEFAULT_PDF_OPTIONS.margins,
        },
      });
      const fs = await import('node:fs/promises');
      let fileBuffer: Buffer;
      try {
        fileBuffer = await fs.readFile(file.path);
      } finally {
        await fs.unlink(file.path).catch(() => {});
      }
      const useCase = new ExportApkgToPdfUseCase(
        this.previewService,
        this.pdfRenderService
      );
      const result = await useCase.execute(
        fileBuffer,
        isPaying(res.locals),
        pdfOptions
      );
      const safeName = file.originalname
        .replace(/\.apkg$/i, '')
        .replace(/[^\w\s.-]/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        buildContentDisposition(`${safeName}.pdf`)
      );
      res.send(result.pdf);
    } catch (error) {
      sendPdfExportError(res, error);
    }
  }

  async exportCsv(req: Request, res: Response) {
    const file = req.file;
    if (file == null) {
      res.status(400).json({ message: 'No file uploaded.' });
      return;
    }
    if (!isApkg(file.originalname)) {
      await tryUnlink(file.path);
      res.status(400).json({ message: 'File must be an .apkg file.' });
      return;
    }
    const fs = await import('node:fs/promises');
    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.readFile(file.path);
    } catch {
      // Without this the rejection escapes the handler entirely — express does
      // not await it — and the unhandled-rejection guard in server.ts exits the
      // process. One anonymous request hitting a reaped temp file would take
      // the whole site down.
      await tryUnlink(file.path);
      res.status(400).json({ message: "Couldn't read the uploaded file." });
      return;
    } finally {
      await tryUnlink(file.path);
    }
    const owner = res.locals.owner;
    const noteLimit = csvNoteLimitFor(owner, isPaying(res.locals));
    try {
      const useCase = new ExportApkgToCsvUseCase();
      const result = await useCase.execute(fileBuffer, noteLimit);
      // A paid day-pass sets `subscriber` without an `owner`, so an owner check
      // alone would file paying customers under anonymous and skew the funnel
      // number this event exists to produce.
      if (owner == null && !isPaying(res.locals)) {
        track('apkg_csv_export_anonymous', {
          userId: null,
          props: { note_count: result.noteCount },
        });
      }
      sendCsvDownload(res, result.csv, file.originalname, result.noteCount);
    } catch (error) {
      sendCsvExportError(res, error, noteLimit);
    }
  }

  async importToNotion(req: Request, res: Response) {
    try {
      if (this.notionService == null || this.jobRepository == null) {
        res.status(500).json({ message: 'Import not configured.' });
        return;
      }

      const file = req.file;
      if (file == null) {
        res.status(400).json({ message: 'No file uploaded.' });
        return;
      }
      if (!isApkg(file.originalname)) {
        res.status(400).json({ message: 'File must be an .apkg file.' });
        return;
      }

      const userIsPaying =
        res.locals.patreon === true || res.locals.subscriber === true;
      const maxNotes = getApkgImportNoteCap(userIsPaying);

      const rawParentPageId = req.body?.parent_page_id;
      const hasExplicitParent =
        typeof rawParentPageId === 'string' &&
        rawParentPageId.trim().length > 0;

      const { owner } = res.locals;
      const notionApi = await this.notionService.getNotionAPI(owner);

      let parentPageId: string;
      if (hasExplicitParent) {
        parentPageId = rawParentPageId.trim();
      } else {
        const resolver = new ResolveImportParentPageUseCase();
        parentPageId = await resolver.execute(notionApi);
      }

      const fs = await import('node:fs/promises');
      let fileBuffer: Buffer;
      try {
        fileBuffer = await fs.readFile(file.path);
      } finally {
        await fs.unlink(file.path).catch(() => {});
      }

      const jobId = randomUUID();
      await this.jobRepository.create(
        jobId,
        owner,
        file.originalname,
        'apkg_import'
      );

      const blocksService = new ApkgToNotionBlocksService();
      const useCase = new ImportApkgToNotionUseCase(
        this.previewService,
        blocksService,
        this.jobRepository
      );

      void useCase.execute(fileBuffer, parentPageId, owner, notionApi, jobId, {
        isPaying: userIsPaying,
        maxNotes,
      });

      res.status(202).json({ job_id: jobId, status: 'queued' });
    } catch (error) {
      sendImportStartError(res, error);
    }
  }

  async downloadEdited(req: Request, res: Response) {
    try {
      const { key } = req.params;
      if (!key || !isApkg(key)) {
        res.status(400).json({ message: 'Not an .apkg upload.' });
        return;
      }
      const rawEdits = (req.body as { edits?: unknown })?.edits;
      if (!Array.isArray(rawEdits)) {
        res.status(400).json({ message: 'edits must be an array.' });
        return;
      }
      const edits = rawEdits.filter(
        (e): e is CardEdit =>
          e != null &&
          typeof e === 'object' &&
          typeof (e as CardEdit).cardIndex === 'number'
      );
      const { owner } = res.locals;
      const storage = new StorageHandler();
      const rawBody = await this.downloadService.getFileBody(
        owner,
        key,
        storage
      );
      if (!rawBody) {
        res.status(404).json({ message: 'Upload not found.' });
        return;
      }
      const useCase = new PackEditedApkgUseCase();
      const result = await useCase.execute({
        sourceBytes: rawBody as Buffer,
        filename: key,
        edits,
      });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        buildContentDisposition(result.filename)
      );
      res.send(result.buffer);
    } catch (error) {
      if (sendApkgTooLarge(res, error)) return;
      if (this.downloadService.isMissingDownloadError(error)) {
        res.status(404).json({ message: 'Upload is no longer available.' });
        return;
      }
      console.error(error);
      sendErrorResponse(error, res);
    }
  }

  async getImportStatus(req: Request, res: Response) {
    try {
      if (this.jobRepository == null) {
        res.status(500).json({ message: 'Import not configured.' });
        return;
      }

      const { jobId } = req.params;
      if (typeof jobId !== 'string' || jobId.trim().length === 0) {
        res.status(400).json({ message: 'Missing job ID.' });
        return;
      }

      const { owner } = res.locals;
      const job = await this.jobRepository.findJobById(jobId, owner);

      if (job == null) {
        res.status(404).json({ message: 'Job not found.' });
        return;
      }

      let progress = { total_notes: 0, imported: 0 };
      let notionPageUrl: string | null = null;
      let errorMessage: string | null = null;
      let truncated = false;

      if (job.status === 'done' && job.job_reason_failure) {
        try {
          const parsed = JSON.parse(job.job_reason_failure);
          progress = {
            total_notes: parsed.total_notes ?? 0,
            imported: parsed.imported ?? 0,
          };
          notionPageUrl = parsed.notion_page_url ?? null;
          truncated = parsed.truncated === true;
        } catch {
          // job_reason_failure is not JSON, ignore
        }
      } else if (job.status === 'failed') {
        errorMessage = job.job_reason_failure;
      } else if (job.status === 'processing' && job.job_reason_failure) {
        const parts = job.job_reason_failure.split('/');
        if (parts.length === 2) {
          progress = {
            imported: parseInt(parts[0], 10) || 0,
            total_notes: parseInt(parts[1].split(' ')[0], 10) || 0,
          };
        }
      }

      const statusText =
        job.status === 'processing' &&
        job.job_reason_failure?.startsWith('uploading')
          ? job.job_reason_failure
          : null;

      res.json({
        status: job.status === 'started' ? 'queued' : job.status,
        progress,
        status_text: statusText,
        notion_page_url: notionPageUrl,
        error: errorMessage,
        truncated,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to get import status.' });
    }
  }
}

function parseDeckId(input: unknown): number | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sendCsvDownload(
  res: Response,
  csv: Buffer,
  originalName: string,
  noteCount: number
): void {
  const trimmed = originalName.replace(/\.apkg$/i, '') || 'deck';
  const safeName = getSafeFilename(trimmed);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    buildContentDisposition(`${safeName}.csv`)
  );
  res.setHeader('X-Card-Count', String(noteCount));
  res.setHeader('Access-Control-Expose-Headers', 'X-Card-Count');
  res.send(csv);
}

function isInvalidApkgError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('No Anki collection') ||
      error.message.includes('open failed'))
  );
}

// Three tiers: no account, free account, paid. Null means unlimited.
function csvNoteLimitFor(owner: unknown, paying: boolean): number | null {
  if (paying) {
    return null;
  }
  return owner == null ? CSV_ANONYMOUS_NOTE_LIMIT : CSV_FREE_NOTE_LIMIT;
}

function sendPdfExportError(res: Response, error: unknown): void {
  if (sendApkgTooLarge(res, error)) return;
  if (error instanceof CardLimitExceededError) {
    res.status(400).json({ message: error.message });
    return;
  }
  if (
    error instanceof Error &&
    (error.message.includes('No Anki collection') ||
      error.message.includes('open failed'))
  ) {
    res.status(400).json({ message: 'Invalid .apkg file' });
    return;
  }
  console.error(error);
  res.status(500).json({ message: 'PDF generation failed.' });
}

function sendImportStartError(res: Response, error: unknown): void {
  if (sendApkgTooLarge(res, error)) return;
  if (error instanceof Error && error.message === 'unauthorized') {
    res.status(400).json({ message: 'Notion is not connected.' });
    return;
  }
  if (error instanceof NoNotionPagesError) {
    res.status(400).json({ message: error.message });
    return;
  }
  if (error instanceof APIResponseError) {
    sendErrorResponse(error, res);
    return;
  }
  console.error(error);
  res.status(500).json({ message: 'Import failed to start.' });
}

function sendApkgTooLarge(res: Response, error: unknown): boolean {
  if (error instanceof ApkgTooLargeError) {
    res.status(413).json({ message: error.message });
    return true;
  }
  return false;
}

function sendCsvExportError(
  res: Response,
  error: unknown,
  noteLimit: number | null
): void {
  if (sendApkgTooLarge(res, error)) return;
  if (error instanceof CsvEmptyDeckError) {
    res.status(400).json({
      message: 'No notes found in this .apkg file. Pick another deck.',
    });
    return;
  }
  if (error instanceof CsvCardLimitExceededError) {
    // The next step differs by tier: someone without an account should be told
    // to sign in for a bigger allowance, not to pay. The client renders this as
    // a neutral gate rather than an error, using the two numbers below.
    res.status(402).json({
      message:
        noteLimit === CSV_ANONYMOUS_NOTE_LIMIT
          ? `This deck has ${error.noteCount} notes. Without an account you can export ${error.noteLimit}.`
          : `This deck has ${error.noteCount} notes. Your plan exports ${error.noteLimit} per file.`,
      note_count: error.noteCount,
      note_limit: error.noteLimit,
      requires_account: noteLimit === CSV_ANONYMOUS_NOTE_LIMIT,
    });
    return;
  }
  if (isInvalidApkgError(error)) {
    res.status(400).json({
      message: "Couldn't read this file as an .apkg deck.",
    });
    return;
  }
  console.error(error);
  res.status(500).json({ message: 'CSV export failed.' });
}

export default ApkgController;
