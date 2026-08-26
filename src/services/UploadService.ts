import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { IUploadRepository } from '../data_layer/UploadRespository';
import JobRepository from '../data_layer/JobRepository';
import UsersRepository from '../data_layer/UsersRepository';
import { ISettingsRepository } from '../data_layer/SettingsRepository';
import { IConversionOutputStatsRepository } from '../data_layer/ConversionOutputStatsRepository';
import { IParsePathSignatureRepository } from '../data_layer/ParsePathSignatureRepository';
import { ICardGuidLedgerRepository } from '../data_layer/CardGuidLedgerRepository';
import ErrorHandler from '../routes/middleware/ErrorHandler';
import CardOption from '../lib/parser/Settings';
import Workspace from '../lib/parser/WorkSpace';
import { logEmptyBackAttribution } from '../lib/parser/logEmptyBackAttribution';
import type { IssuedCardGuid, KnownGuids } from '../lib/anki/guidLedgerTypes';
import StorageHandler from '../lib/storage/StorageHandler';
import { UploadedFile } from '../lib/storage/types';
import GeneratePackagesUseCase from '../usecases/uploads/GeneratePackagesUseCase';
import { toText } from './NotionService/BlockHandler/helpers/deckNameToText';
import { isPaying } from '../lib/isPaying';
import { isLimitError } from '../lib/misc/isLimitError';
import { handleUploadLimitError } from '../controllers/Upload/helpers/handleUploadLimitError';
import { getUploadValidationError } from '../lib/upload/getUploadValidationError';
import { isImageOnlyUpload } from '../lib/upload/isImageOnlyUpload';
import { decodeUploadImage } from '../lib/upload/decodeUploadImage';
import { PhotoToFlashcardsUseCase } from '../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import { EmptyDeckError } from '../usecases/jobs/EmptyDeckError';
import { UploadFileUnavailableError } from '../usecases/uploads/UploadFileUnavailableError';
import { isExpectedClientFault } from '../lib/misc/isExpectedClientFault';
import type { DeckScore } from '../lib/parser/scoreCandidateDeck';
import type { InducedRescue } from '../lib/parser/induction/candidateRules';
import { toCardCountBucket } from '../lib/analytics/cardCountBucket';
import { uploadInputFormat } from '../lib/analytics/uploadInputFormat';
import {
  CONVERSION_TRUNCATED_MESSAGE,
  FileConversionError,
} from '../infrastracture/adapters/fileConversion/claudeFileConversion';
import {
  CONVERSION_FALLBACK_FILENAME,
  loadPdfImageFallbackNames,
  matchesPdfImageFallback,
} from '../infrastracture/adapters/fileConversion/pdfImageFallbackMarker';
import type {
  ConversionScoreSource,
  IConversionRuleScoresRepository,
} from '../data_layer/ConversionRuleScoresRepository';
import type { ConversionEngine } from '../lib/parser/conversionEngine';
import {
  MARKDOWN_LIKELY_LOSSY_REASON,
  jobFailureReasonFromError,
} from '../usecases/jobs/jobFailureReason';
import { DeckTooLargeError } from '../lib/parser/exporters/DeckTooLargeError';
import { getOwner } from '../lib/User/getOwner';
import { censusUploadedFile } from '../infrastracture/adapters/fileConversion/documentStructureCensus';
import { formatDeckName } from '../lib/formatDeckName';
import {
  CheckMonthlyCardLimitUseCase,
  MonthlyLimitError,
  AnonymousCardCapError,
  ANONYMOUS_CARD_CAP,
  MONTHLY_CARD_LIMIT,
} from '../usecases/users/CheckMonthlyCardLimitUseCase';
import {
  generateDeckInfo,
  DeckInfo,
  ClaudeParseError,
  ClaudeLargeSectionError,
  ImageOnlyContentError,
} from '../lib/claude/ClaudeService';
import CustomExporter from '../lib/parser/exporters/CustomExporter';
import Deck from '../lib/parser/Deck';
import { isHTMLFile, isMarkdownFile } from '../lib/storage/checks';
import { FileSizeInMegaBytes } from '../lib/misc/file';
import {
  isWorkerTerminationError,
  WORKER_INTERRUPTED_REASON,
} from '../lib/workerTermination';
import { track } from './events/track';
import { parseFirstTouch } from '../controllers/helpers/parseFirstTouch';
import { classifyDevice } from '../lib/analytics/classifyDevice';
import {
  validateUploadSource,
  UploadSource,
} from '../lib/upload/validateUploadSource';
import {
  isPdfPasswordSentinel,
  parsePdfPasswordSentinel,
} from '../lib/pdf/pdfPasswordSentinel';

interface EmptyDeckResponse {
  code: 'empty_export';
  message: string;
  filename: string;
  docsLink: string;
}

interface MarkdownLossyResponse {
  code: 'markdown_likely_lossy';
  message: string;
  filename: string;
}

interface ImageOnlyResponse {
  code: 'image_only_no_text';
  message: string;
  filename: string;
  photoToDeckUrl: string;
}

const IMAGE_ONLY_NO_TEXT_MESSAGE =
  'These look like images — no text to read. Turn them into cards with Photo to Deck.';

const AI_FALLBACK_MAX_BYTES = 50 * 1024 * 1024;

interface DeckTooLargeResponse {
  message: string;
}

interface BatchDeckResult {
  name: string;
  filename: string;
  downloadUrl: string;
}

interface BatchUploadResponse {
  kind: 'batch';
  workspaceId: string;
  deckCount: number;
  decks: BatchDeckResult[];
  bulkUrl: string;
  warning?: string;
  droppedImageCount?: number;
  expiredNotionImageCount?: number;
  emptyBackCount?: number;
  structureRescuedRule?: string;
}

const MARKDOWN_HEURISTIC_WARNING =
  'Your Markdown file was processed using heuristic detection. For reliable results, use the nested bullet format or enable Claude AI in settings.';

function resolveUploadWarning(warnings: string[] | undefined): string | null {
  if (!warnings || warnings.length === 0) return null;
  const passwordWarning = warnings.find((w) =>
    w.includes('password-protected')
  );
  if (passwordWarning) return passwordWarning;
  if (warnings.includes('markdown-heuristic')) {
    return MARKDOWN_HEURISTIC_WARNING;
  }
  return null;
}

function shippedRescueRule(
  packages: { inducedRule?: InducedRescue }[]
): string | undefined {
  const shipped = packages.find(
    (p) => p.inducedRule?.outcome === 'rescue_shipped'
  );
  return shipped?.inducedRule?.rule;
}

function sumDroppedImages(packages: { droppedImageCount?: number }[]): number {
  return packages.reduce((sum, p) => sum + (p.droppedImageCount ?? 0), 0);
}

function sumExpiredNotionImages(
  packages: { expiredNotionImageCount?: number }[]
): number {
  return packages.reduce((sum, p) => sum + (p.expiredNotionImageCount ?? 0), 0);
}

function hasSessionToken(req: express.Request): boolean {
  const token = (req.cookies as Record<string, unknown> | undefined)?.token;
  return typeof token === 'string' && token.length > 0;
}

async function readUploadBytes(file: UploadedFile): Promise<Buffer | null> {
  if (file.buffer != null) {
    return file.buffer;
  }
  if (file.path != null && file.path !== '') {
    try {
      return await fs.promises.readFile(file.path);
    } catch {
      return null;
    }
  }
  return null;
}

function deckNameFromImageFilename(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '').trim();
  return base.length > 0 ? base : 'Photo deck';
}

function imageConversionErrorStatus(err: unknown): number | null {
  if (err instanceof Error) {
    const status = (err as Error & { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return null;
}

const CONVERSION_SETTINGS_FILENAME = 'conversion-settings.json';

function persistConversionSettings(workspaceDir: string, body: unknown): void {
  try {
    const entries = Object.entries(
      (body ?? {}) as Record<string, unknown>
    ).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    );
    fs.writeFileSync(
      path.join(workspaceDir, CONVERSION_SETTINGS_FILENAME),
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch (error) {
    console.warn('[UploadService] failed to persist conversion settings', {
      workspaceDir,
      error,
    });
  }
}

function loadPersistedConversionSettings(
  workspaceDir: string
): CardOption | null {
  const settingsPath = path.join(workspaceDir, CONVERSION_SETTINGS_FILENAME);
  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const input = Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
    return new CardOption(input);
  } catch (error) {
    console.warn('[UploadService] ignoring unreadable conversion settings', {
      workspaceDir,
      error,
    });
    return null;
  }
}

function walkHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkHtmlFiles(full));
    } else if (isHTMLFile(entry.name) || isMarkdownFile(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function walkMediaFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMediaFiles(full));
    } else if (
      !isHTMLFile(entry.name) &&
      !isMarkdownFile(entry.name) &&
      !entry.name.endsWith('.apkg') &&
      entry.name !== CONVERSION_SETTINGS_FILENAME &&
      entry.name !== CONVERSION_FALLBACK_FILENAME &&
      entry.name !== 'guids.json'
    ) {
      results.push(entry.name);
    }
  }
  return results;
}

// A restart of a PDF-image-fallback job re-reads the page images the original
// conversion rendered into the workspace. The 2h tmp reaper can remove those
// images while the workspace dir (and its restart-refreshed HTML) survives, so
// a dir-exists check alone lets the restart run straight into a guaranteed
// empty-content failure (#4172). Media surviving anywhere in the workspace is
// enough to let the restart try; the per-image truth is settled by the
// conversion itself.
function restartNeedsMissingPageImages(workspaceDir: string): boolean {
  if (loadPdfImageFallbackNames(workspaceDir).size === 0) return false;
  return walkMediaFiles(workspaceDir).length === 0;
}

function resolveAsyncFailureReason(err: unknown, jobId: string): string {
  if (err instanceof MonthlyLimitError) {
    return JSON.stringify({
      code: 'monthly_limit',
      cards_used: err.cards_used,
      limit: err.limit,
      reset_on: err.reset_on,
    });
  }
  // Everything else goes through the allowlist, which decides what a user is
  // allowed to read. Returning `message` here instead meant any library or
  // driver text reached the downloads page verbatim — a user was once shown an
  // Anthropic SDK error complete with a link to its GitHub repo.
  return jobFailureReasonFromError(err, jobId);
}

function logNoPackageDiagnostics(uploadedFiles: UploadedFile[]) {
  console.info('[no-package] Zero packages produced. File diagnostics:');
  for (const file of uploadedFiles ?? []) {
    console.info(
      `  name=${file.originalname} mimetype=${file.mimetype} size=${file.size}`
    );
    try {
      const contents = file.path ? fs.readFileSync(file.path) : file.buffer;
      if (!contents) {
        console.info('  no file contents available for diagnostics');
        continue;
      }
      if (/\.zip$/i.test(file.originalname)) {
        // Raw zip bytes as a "snippet" are noise and the toggle heuristics
        // always read false on binary — the zip census below is the signal.
        console.info('  zip archive: entry census follows');
      } else {
        const head = contents.slice(0, 1000).toString('utf8');
        const hasDisplayContents = head.includes('display:contents');
        const hasToggleClass = head.includes('class="toggle"');
        const hasDetails = head.includes('<details');
        console.info(`  snippet=${JSON.stringify(head.slice(0, 300))}`);
        console.info(
          `  display:contents=${hasDisplayContents} .toggle=${hasToggleClass} <details=${hasDetails}`
        );
      }
      // Structural shape, not content — makes the zero-card class
      // reproducible from logs alone (#3966). Fire and forget: the census
      // may re-run a DOCX conversion and must never delay the response.
      censusUploadedFile({ originalname: file.originalname, buffer: contents })
        .then((census) => {
          if (census != null) {
            console.info(
              `  census=${JSON.stringify(census)} name=${file.originalname}`
            );
          }
        })
        .catch(() => {});
    } catch (readErr) {
      console.error(`  could not read file: ${readErr}`);
    }
  }
}

class UploadService {
  private readonly inFlightConversions = new Set<string>();

  getUploadsByOwner(owner: number) {
    return this.uploadRepository.getUploadsByOwner(owner);
  }

  constructor(
    private readonly uploadRepository: IUploadRepository,
    private readonly jobRepository: JobRepository,
    private readonly usersRepository: UsersRepository,
    private readonly settingsRepository: ISettingsRepository,
    private readonly conversionOutputStatsRepository: IConversionOutputStatsRepository,
    private readonly parsePathSignatureRepository: IParsePathSignatureRepository,
    private readonly conversionRuleScoresRepository: IConversionRuleScoresRepository,
    private readonly cardGuidLedgerRepository: ICardGuidLedgerRepository,
    private readonly photoToFlashcardsUseCase: PhotoToFlashcardsUseCase
  ) {}

  // Every conversion is scored, not just fallbacks — without the baseline there
  // is nothing to compare a rescued deck against. Fire and forget: a metrics
  // write must never fail a conversion the user is waiting on.
  // The entry point, not the engine. resolveUploadSource already distinguishes
  // web/app/dropbox/google_drive from the request; the MCP caller is only
  // visible on res.locals, so it is checked before the request-derived sources.
  private resolveScoreSource(
    req: express.Request,
    res: express.Response
  ): ConversionScoreSource {
    if (res.locals.mcp_auth === true) return 'mcp';
    return this.resolveUploadSource(req) as ConversionScoreSource;
  }

  private recordDeckScores(
    packages: {
      parsePath?: string;
      engine?: ConversionEngine;
      score?: DeckScore;
      inducedRule?: InducedRescue;
    }[],
    owner: number | null,
    source: ConversionScoreSource,
    inputFormat: string
  ): void {
    for (const pkg of packages) {
      if (pkg.score == null) continue;
      const induced = pkg.inducedRule;
      // A rejected rescue records the candidate the induction actually judged,
      // not the empty deck that ships; a shipped rescue records the real
      // shipped deck (pkg.score).
      const score =
        induced?.outcome === 'rescue_rejected' && induced.score != null
          ? induced.score
          : pkg.score;
      this.conversionRuleScoresRepository
        .record({
          owner,
          source,
          engine: pkg.engine ?? 'parser',
          inputFormat,
          rule: induced?.rule ?? pkg.parsePath ?? 'unknown',
          wasFallback: induced != null || pkg.parsePath === 'unclassified',
          outcome:
            induced?.outcome ??
            (pkg.score.cardCount > 0 ? 'shipped' : 'no_cards'),
          score,
        })
        .catch((error) =>
          console.error(
            '[UploadService] failed to record conversion rule score',
            error
          )
        );
    }
  }

  private async loadKnownGuids(
    ownerId: number | null
  ): Promise<KnownGuids | undefined> {
    if (ownerId == null) {
      return undefined;
    }
    try {
      return await this.cardGuidLedgerRepository.getAllForOwner(ownerId);
    } catch (error) {
      console.warn('[UploadService] card guid ledger read failed', error);
      return undefined;
    }
  }

  private recordIssuedGuids(
    packages: { guidEntries?: IssuedCardGuid[] }[],
    ownerId: number | null
  ): void {
    if (ownerId == null) {
      return;
    }
    const entries = packages.flatMap((p) => p.guidEntries ?? []);
    if (entries.length === 0) {
      return;
    }
    this.cardGuidLedgerRepository.record(ownerId, entries).catch((error) => {
      console.warn('[UploadService] card guid ledger write failed', error);
    });
  }

  private recordConversionOutput(
    packages: {
      cardCount?: number;
      emptyBackCount?: number;
      parsePath?: string;
      engine?: ConversionEngine;
      score?: DeckScore;
    }[],
    owner?: number | null,
    source?: ConversionScoreSource,
    inputFormat?: string
  ): void {
    const cards = packages.reduce((sum, p) => sum + (p.cardCount ?? 0), 0);
    const emptyBack = packages.reduce(
      (sum, p) => sum + (p.emptyBackCount ?? 0),
      0
    );
    this.conversionOutputStatsRepository
      .record('upload', { decks: packages.length, cards, emptyBack })
      .catch((error) =>
        console.error(
          '[UploadService] failed to record conversion output stats',
          error
        )
      );
    const parsePaths = packages
      .map((p) => p.parsePath)
      .filter((p): p is string => typeof p === 'string');
    if (parsePaths.length > 0) {
      this.parsePathSignatureRepository
        .record(parsePaths)
        .catch((error) =>
          console.error(
            '[UploadService] failed to record parse path signatures',
            error
          )
        );
    }
  }

  async restartClaudeJob(req: express.Request, res: express.Response) {
    const owner = String(getOwner(res));
    const { jobId } = req.params;
    const job = await this.jobRepository.findJobById(jobId, owner);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const workspaceDir = path.join(
      process.env.WORKSPACE_BASE as string,
      job.object_id
    );
    if (
      !fs.existsSync(workspaceDir) ||
      restartNeedsMissingPageImages(workspaceDir)
    ) {
      res.status(409).json({
        error: 'Workspace files are no longer available',
        code: 'workspace_gone',
      });
      return;
    }

    const claimed = await this.jobRepository.restartJob(job.object_id, owner);
    if (claimed == null) {
      res.status(409).json({
        error: 'This job is already running',
        code: 'already_running',
      });
      return;
    }

    const paying = isPaying(res.locals);
    this.runClaudeRestart(
      job.object_id,
      owner,
      workspaceDir,
      paying,
      async (step) => {
        await this.jobRepository.updateJobStatus(job.object_id, owner, step);
      }
    ).catch(async (err: Error) => {
      if (isWorkerTerminationError(err)) {
        console.info('[UploadService] restart interrupted by pool drain', {
          jobId: job.object_id,
        });
        await this.jobRepository.updateJobStatus(
          job.object_id,
          owner,
          'interrupted',
          WORKER_INTERRUPTED_REASON
        );
        return;
      }
      await this.jobRepository.updateJobStatus(
        job.object_id,
        owner,
        'failed',
        resolveAsyncFailureReason(err, job.object_id)
      );
    });

    res.status(202).json({ jobId: job.object_id });
  }

  private async promoteClaudeJobToUpload(
    objectId: string,
    workspaceDir: string,
    owner: string,
    totalCards = 0,
    source: UploadSource | null = null,
    paying = false
  ): Promise<void> {
    await new CheckMonthlyCardLimitUseCase(this.usersRepository).execute({
      userId: owner,
      candidateCardCount: totalCards,
      isPaying: paying,
    });
    const files = await fs.promises.readdir(workspaceDir);
    const apkgFilename = files.find((f) => f.endsWith('.apkg'));
    if (!apkgFilename) {
      throw new Error('No APKG file found in workspace');
    }
    await this.jobRepository.updateJobStatus(
      objectId,
      owner,
      'step3_building_deck',
      ''
    );
    const apkgPath = path.join(workspaceDir, apkgFilename);
    const apkgBuffer = await fs.promises.readFile(apkgPath);
    const storage = new StorageHandler();
    const key = storage.uniqify(objectId, owner, 200, 'apkg');
    await storage.uploadFile(key, apkgBuffer);
    const sizeMb = FileSizeInMegaBytes(apkgPath);
    await this.uploadRepository.update(
      Number(owner),
      apkgFilename,
      key,
      sizeMb,
      source
    );
    await this.usersRepository.incrementCardUsage(Number(owner), totalCards);
    const job = await this.jobRepository.findJobById(objectId, owner);
    if (job) {
      await this.jobRepository.deleteJob(String(job.id), owner);
    }
  }

  private async runClaudeRestart(
    objectId: string,
    owner: string,
    workspaceDir: string,
    paying: boolean,
    onProgress: (step: string) => Promise<void>
  ) {
    const htmlFiles = walkHtmlFiles(workspaceDir);
    const mediaFiles = walkMediaFiles(workspaceDir);

    if (htmlFiles.length === 0) {
      throw new Error('No HTML files found in workspace');
    }

    const settings = loadPersistedConversionSettings(workspaceDir);
    const fallbackNames = loadPdfImageFallbackNames(workspaceDir);
    const ownerNumeric = Number(owner);
    const generateOptions = {
      isPaying: paying,
      userId:
        Number.isFinite(ownerNumeric) && ownerNumeric > 0 ? ownerNumeric : null,
      comprehensive: settings?.aiComprehensive,
    };

    const deckInfoArrays: DeckInfo[][] = [];
    for (const htmlFile of htmlFiles) {
      const content = await fs.promises.readFile(htmlFile, 'utf8');
      const options = matchesPdfImageFallback(
        htmlFile,
        workspaceDir,
        fallbackNames
      )
        ? {
            ...generateOptions,
            pdfImageFallback: {
              mediaBaseDir: workspaceDir,
              attachPageImages: settings?.embedImages ?? true,
            },
          }
        : generateOptions;
      const deckInfo = await generateDeckInfo(
        content,
        mediaFiles,
        settings?.userInstructions,
        onProgress,
        settings?.cardStyle || undefined,
        settings?.cardSize,
        settings?.fieldMapping,
        options
      );
      deckInfoArrays.push(deckInfo);
    }

    const deckInfo = deckInfoArrays.flat().filter((d) => d.cards.length > 0);
    if (deckInfo.length === 0) {
      throw new Error('No packages produced');
    }

    const totalCards = deckInfo.reduce((sum, d) => sum + d.cards.length, 0);
    const deckName = deckInfo[0].name;
    const exporter = new CustomExporter(deckName, workspaceDir);
    exporter.configure(deckInfo as unknown as Deck[]);
    await exporter.save();

    await this.promoteClaudeJobToUpload(
      objectId,
      workspaceDir,
      owner,
      totalCards,
      null,
      paying
    );
  }

  async deleteUpload(owner: number, key: string) {
    const upload = await this.uploadRepository.findByKey(owner, key);
    const s = new StorageHandler();
    await this.uploadRepository.deleteUpload(owner, key);
    await s.delete(key);
    if (upload?.object_id) {
      await this.jobRepository.deleteJobByObjectId(
        upload.object_id,
        String(owner)
      );
    }
  }

  async handleUpload(req: express.Request, res: express.Response) {
    try {
      const validationError = getUploadValidationError(
        req.files as UploadedFile[]
      );
      if (validationError) {
        res.status(400).contentType('text/plain').send(validationError.message);
        return;
      }

      const settings = new CardOption(req.body || {});
      const ws = new Workspace(true, 'fs');
      const owner = getOwner(res);
      const paying = isPaying(res.locals);

      if (owner != null && settings.n2aBasic == null) {
        await this.settingsRepository.attachCustomTemplates(
          String(owner),
          settings
        );
      }

      track('upload_started', {
        userId: owner != null ? Number(owner) : null,
        anonymousId: this.resolveAnonId(req),
        props: {
          ...this.baseFunnelProps(req),
          device: classifyDevice(req.headers?.['user-agent']),
        },
      });

      const files = req.files as UploadedFile[];
      if (owner != null && files.length === 1 && isImageOnlyUpload(files)) {
        return await this.handleImageUpload(req, res, String(owner), paying);
      }

      if (owner != null && paying && settings.claudeAIFlashcards) {
        return await this.handleAsyncUpload(
          req,
          res,
          settings,
          ws,
          String(owner),
          paying
        );
      }

      return await this.handleSyncUpload(req, res, settings, ws, paying);
    } catch (err) {
      if (err instanceof MonthlyLimitError) {
        const owner = getOwner(res);
        const userId = owner != null ? Number(owner) : null;
        const source = this.resolveUploadSource(req);
        const anonymousId = this.resolveAnonId(req);
        track('conversion_failed', {
          userId,
          anonymousId,
          props: {
            ...this.baseFunnelProps(req),
            reason: 'monthly_limit',
          },
        });
        track('paywall_shown', {
          userId,
          anonymousId,
          props: { source, kind: 'card_count' },
        });
        return res.redirect('/limit?kind=card_count');
      } else if (err instanceof AnonymousCardCapError) {
        const owner = getOwner(res);
        const userId = owner != null ? Number(owner) : null;
        const source = this.resolveUploadSource(req);
        const anonymousId = this.resolveAnonId(req);
        track('conversion_failed', {
          userId,
          anonymousId,
          props: {
            ...this.baseFunnelProps(req),
            reason: 'anonymous_cap',
          },
        });
        track('paywall_shown', {
          userId,
          anonymousId,
          props: { source, kind: 'anonymous' },
        });
        return res.redirect('/limit?kind=anonymous');
      } else if (isLimitError(err as Error)) {
        handleUploadLimitError(req, res);
      } else if (err instanceof EmptyDeckError) {
        const files = req.files as UploadedFile[] | undefined;
        const filename = files?.[0]?.originalname ?? 'your file';
        if (err.sourceFormat === 'markdown') {
          const body: MarkdownLossyResponse = {
            code: 'markdown_likely_lossy',
            message: MARKDOWN_LIKELY_LOSSY_REASON,
            filename,
          };
          return res.status(400).json(body);
        }
        if (isImageOnlyUpload(files)) {
          const owner = getOwner(res);
          track('image_only_no_text_shown', {
            userId: owner != null ? Number(owner) : null,
            anonymousId: this.resolveAnonId(req),
            props: { source: this.resolveUploadSource(req) },
          });
          const body: ImageOnlyResponse = {
            code: 'image_only_no_text',
            message: IMAGE_ONLY_NO_TEXT_MESSAGE,
            filename,
            photoToDeckUrl: '/photo-to-deck',
          };
          return res.status(400).json(body);
        }
        const body: EmptyDeckResponse = {
          code: 'empty_export',
          message:
            'No cards were found in this file. Most files need a toggle-list (Notion) or a question/answer pair to become cards. See common problems for the formats that work.',
          filename,
          docsLink: '/documentation/help/common-problems',
        };
        return res.status(400).json(body);
      } else if (err instanceof Error && err.name === 'EmptyContentError') {
        return res.status(400).json({
          code: 'empty_content',
          message: err.message,
        });
      } else if (err instanceof DeckTooLargeError) {
        const body: DeckTooLargeResponse = {
          message:
            'This export is too large to process in one go. Try splitting it into smaller pages, removing embedded images, or enabling Claude AI in settings to process it in chunks.',
        };
        return res.status(400).json(body);
      } else if (err instanceof UploadFileUnavailableError) {
        const owner = getOwner(res);
        track('conversion_failed', {
          userId: owner != null ? Number(owner) : null,
          anonymousId: this.resolveAnonId(req),
          props: {
            ...this.baseFunnelProps(req),
            reason: 'upload_incomplete',
          },
        });
        return res.status(400).json({
          code: 'upload_incomplete',
          message:
            'Your upload didn’t finish, so there was nothing to convert. Upload the file again.',
        });
      } else if (err instanceof Error && isPdfPasswordSentinel(err.message)) {
        const filename = parsePdfPasswordSentinel(err.message) ?? 'your file';
        return res.status(400).json({
          error: 'needs_password',
          reason: 'missing_password',
          filename,
        });
      } else if (
        err instanceof Error &&
        /^pdfinfo_(failed|spawn_failed)/.test(err.message)
      ) {
        return res.status(400).json({
          code: 'pdf_processing_failed',
          message:
            'We could not read this PDF. It may be corrupted, password-protected, or an unsupported variant. Try re-exporting the PDF or splitting it into smaller files.',
        });
      } else if (
        err instanceof Error &&
        /^docx_parse_failed/.test(err.message)
      ) {
        return res.status(400).json({
          code: 'docx_processing_failed',
          message:
            "We couldn't read this .docx. It may have been renamed from another format. Try re-exporting it from Word or Google Docs.",
        });
      } else {
        return ErrorHandler(res, req, err as Error);
      }
    }
  }

  private static conversionFingerprint(
    owner: string,
    files: UploadedFile[]
  ): string {
    const hash = createHash('sha256');
    hash.update(owner);
    const sorted = [...files].sort((a, b) =>
      a.originalname.localeCompare(b.originalname)
    );
    for (const file of sorted) {
      hash.update('\0');
      hash.update(file.originalname);
      hash.update(String(file.size ?? ''));
      if (file.buffer != null) {
        hash.update(file.buffer);
      }
    }
    return hash.digest('hex');
  }

  private async handleAsyncUpload(
    req: express.Request,
    res: express.Response,
    settings: CardOption,
    ws: Workspace,
    owner: string,
    paying: boolean
  ) {
    const files = req.files as UploadedFile[];
    const fingerprint = UploadService.conversionFingerprint(owner, files);
    if (this.inFlightConversions.has(fingerprint)) {
      return res.status(409).json({
        code: 'conversion_in_flight',
        message:
          "We're already converting this file. It'll land in My Decks in a few minutes — no need to upload again.",
      });
    }
    this.inFlightConversions.add(fingerprint);
    const title =
      files.length === 1 ? files[0].originalname : `${files.length} files`;
    try {
      await this.jobRepository.create(ws.id, owner, title, 'claude');
    } catch (err) {
      this.inFlightConversions.delete(fingerprint);
      throw err;
    }
    persistConversionSettings(ws.location, req.body);

    const ownerForEvent = Number(owner);
    track('conversion_started', {
      userId: Number.isFinite(ownerForEvent) ? ownerForEvent : null,
      anonymousId: this.resolveAnonId(req),
      props: { source: this.resolveUploadSource(req), mode: 'async' },
    });

    const source = this.resolvePersistedSource(req);
    const useCase = new GeneratePackagesUseCase();
    const ownerNumeric = Number(owner);
    const ownerId =
      Number.isFinite(ownerNumeric) && ownerNumeric > 0 ? ownerNumeric : null;
    const knownGuids = await this.loadKnownGuids(ownerId);
    useCase
      .execute(
        paying,
        req.files as UploadedFile[],
        settings,
        ws,
        async (step) => {
          await this.jobRepository.updateJobStatus(ws.id, owner, step);
        },
        ownerId,
        knownGuids
      )
      .then(async ({ packages }) => {
        this.recordIssuedGuids(packages, ownerId);
        const totalCards = packages.reduce((s, p) => s + (p.cardCount ?? 0), 0);
        // Scores record either way. The conversion-output stats below stay
        // behind the gate — they count delivered cards — but a conversion that
        // produced nothing is the most informative row the score table can
        // hold, and gating it left the corpus made only of successes.
        this.recordDeckScores(
          packages,
          ownerId,
          this.resolveScoreSource(req, res),
          uploadInputFormat(req.files as UploadedFile[])
        );
        if (totalCards > 0) {
          this.recordConversionOutput(
            packages,
            ownerId,
            this.resolveScoreSource(req, res),
            uploadInputFormat(req.files as UploadedFile[])
          );
          logEmptyBackAttribution(packages, this.resolveUploadSource(req));
          await this.promoteClaudeJobToUpload(
            ws.id,
            ws.location,
            owner,
            totalCards,
            source,
            paying
          );
          track('conversion_succeeded', {
            userId: Number(owner),
            anonymousId: this.resolveAnonId(req),
            props: {
              ...this.baseFunnelProps(req),
              card_count_bucket: toCardCountBucket(totalCards),
            },
          });
        } else {
          logNoPackageDiagnostics(req.files as UploadedFile[]);
          await this.jobRepository.updateJobStatus(
            ws.id,
            owner,
            'failed',
            jobFailureReasonFromError(new EmptyDeckError(), ws.id)
          );
        }
      })
      .catch(async (err: unknown) => {
        if (isWorkerTerminationError(err)) {
          console.info('[UploadService] async job interrupted by pool drain', {
            jobId: ws.id,
          });
          await this.jobRepository.updateJobStatus(
            ws.id,
            owner,
            'interrupted',
            WORKER_INTERRUPTED_REASON
          );
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const isExpectedState =
          err instanceof EmptyDeckError ||
          err instanceof ClaudeParseError ||
          err instanceof ClaudeLargeSectionError ||
          (err instanceof Error && err.name === 'EmptyContentError') ||
          (err instanceof FileConversionError &&
            err.message === CONVERSION_TRUNCATED_MESSAGE) ||
          err instanceof ImageOnlyContentError ||
          (err instanceof Error && isExpectedClientFault(err)) ||
          (err instanceof Error && isPdfPasswordSentinel(err.message)) ||
          (err instanceof Error && err.name === 'PythonZeroCardsError') ||
          (err instanceof Error && /^docx_parse_failed/.test(err.message));
        if (isExpectedState) {
          console.info('[UploadService] async job user-input state', {
            jobId: ws.id,
            kind: err instanceof Error ? err.name : 'unknown',
          });
        } else {
          console.error('[UploadService] async job failed', {
            jobId: ws.id,
            message,
            err,
          });
        }
        const reason = resolveAsyncFailureReason(err, ws.id);
        await this.jobRepository.updateJobStatus(
          ws.id,
          owner,
          'failed',
          reason
        );
      })
      .finally(() => {
        this.inFlightConversions.delete(fingerprint);
      });

    return res.status(202).json({ jobId: ws.id });
  }

  private canFallBackToClaude(
    req: express.Request,
    owner: number | null,
    paying: boolean
  ): boolean {
    if (owner == null || !paying) {
      return false;
    }
    const files = req.files as UploadedFile[] | undefined;
    if (isImageOnlyUpload(files)) {
      return false;
    }
    const rawFlag = (req.body as Record<string, unknown> | undefined)?.[
      'claude-ai-flashcards'
    ];
    if (rawFlag === 'false') {
      return false;
    }
    const totalBytes = (files ?? []).reduce((sum, file) => sum + file.size, 0);
    return totalBytes <= AI_FALLBACK_MAX_BYTES;
  }

  private buildClaudeFallbackSettings(
    req: express.Request,
    base: CardOption
  ): CardOption {
    const body = (req.body ?? {}) as Record<string, string>;
    const fallback = new CardOption({
      ...body,
      'claude-ai-flashcards': 'true',
    });
    fallback.n2aBasic = base.n2aBasic;
    fallback.n2aCloze = base.n2aCloze;
    fallback.n2aInput = base.n2aInput;
    return fallback;
  }

  private async handleSyncUpload(
    req: express.Request,
    res: express.Response,
    settings: CardOption,
    ws: Workspace,
    paying: boolean
  ) {
    const owner = getOwner(res);
    track('conversion_started', {
      userId: owner != null ? Number(owner) : null,
      anonymousId: this.resolveAnonId(req),
      props: { source: this.resolveUploadSource(req), mode: 'sync' },
    });

    const useCase = new GeneratePackagesUseCase();
    const syncOwnerNumeric = Number(owner);
    const syncOwnerId =
      Number.isFinite(syncOwnerNumeric) && syncOwnerNumeric > 0
        ? syncOwnerNumeric
        : null;
    const knownGuids = await this.loadKnownGuids(syncOwnerId);
    const { packages, warnings } = await useCase.execute(
      paying,
      req.files as UploadedFile[],
      settings,
      ws,
      undefined,
      syncOwnerId,
      knownGuids
    );
    this.recordIssuedGuids(packages, syncOwnerId);

    const totalCards = packages.reduce((s, p) => s + (p.cardCount ?? 0), 0);
    const authenticated = hasSessionToken(req);

    // Before the empty-deck throw, so a document that produced nothing still
    // lands a row — that population is the one a rescue has to clear.
    this.recordDeckScores(
      packages,
      owner != null ? Number(owner) : null,
      this.resolveScoreSource(req, res),
      uploadInputFormat(req.files as UploadedFile[])
    );

    if (totalCards === 0) {
      logNoPackageDiagnostics(req.files as UploadedFile[]);
      const ownerId = owner != null ? Number(owner) : null;
      if (this.canFallBackToClaude(req, ownerId, paying)) {
        track('ai_fallback_triggered', {
          userId: ownerId,
          anonymousId: this.resolveAnonId(req),
          props: {
            reason: 'empty_deck',
            source: this.resolveUploadSource(req),
          },
        });
        return await this.handleAsyncUpload(
          req,
          res,
          this.buildClaudeFallbackSettings(req, settings),
          new Workspace(true, 'fs'),
          String(owner),
          paying
        );
      }
      track('conversion_failed', {
        userId: ownerId,
        anonymousId: this.resolveAnonId(req),
        props: {
          ...this.baseFunnelProps(req),
          reason: 'empty_deck',
        },
      });
      throw new EmptyDeckError();
    }

    this.recordConversionOutput(
      packages,
      owner != null ? Number(owner) : null,
      this.resolveScoreSource(req, res),
      uploadInputFormat(req.files as UploadedFile[])
    );
    logEmptyBackAttribution(packages, this.resolveUploadSource(req));

    if (owner != null) {
      await new CheckMonthlyCardLimitUseCase(this.usersRepository).execute({
        userId: owner,
        candidateCardCount: totalCards,
        isPaying: paying,
      });
    } else if (totalCards > ANONYMOUS_CARD_CAP) {
      if (authenticated) {
        throw new MonthlyLimitError(
          MONTHLY_CARD_LIMIT,
          MONTHLY_CARD_LIMIT,
          totalCards,
          new Date().toISOString()
        );
      }
      throw new AnonymousCardCapError(totalCards, ANONYMOUS_CARD_CAP);
    }

    const totalEmptyBackCount = packages.reduce(
      (sum, p) => sum + (p.emptyBackCount ?? 0),
      0
    );

    const first = packages[0];
    if (packages.length === 1) {
      const apkg = await ws.getFirstAPKG();
      if (!apkg) {
        const name = first ? first.name : 'untitled';
        throw new Error(`Could not produce APKG for ${name}`);
      }
      const plen = Buffer.byteLength(apkg);
      const totalMcqCount = packages.reduce(
        (sum, p) => sum + (p.mcqCount ?? 0),
        0
      );
      const totalMcqSkippedCount = packages.reduce(
        (sum, p) => sum + (p.mcqSkippedCount ?? 0),
        0
      );
      const totalDroppedImageCount = sumDroppedImages(packages);
      const totalExpiredNotionImageCount = sumExpiredNotionImages(packages);
      res.set('Content-Type', 'application/apkg');
      res.set('Content-Length', plen.toString());
      res.set('X-Card-Count', totalCards.toString());
      res.set('X-MCQ-Count', totalMcqCount.toString());
      res.set('X-MCQ-Skipped-Count', totalMcqSkippedCount.toString());
      const exposedHeaders = [
        'File-Name',
        'X-Card-Count',
        'X-MCQ-Count',
        'X-MCQ-Skipped-Count',
      ];
      if (totalDroppedImageCount > 0) {
        res.set('X-Dropped-Assets', totalDroppedImageCount.toString());
        exposedHeaders.push('X-Dropped-Assets');
      }
      if (totalExpiredNotionImageCount > 0) {
        res.set(
          'X-Expired-Notion-Assets',
          totalExpiredNotionImageCount.toString()
        );
        exposedHeaders.push('X-Expired-Notion-Assets');
      }
      if (totalEmptyBackCount > 0) {
        res.set('X-Empty-Back-Count', totalEmptyBackCount.toString());
        exposedHeaders.push('X-Empty-Back-Count');
      }
      if (packages.some((p) => p.overSplit)) {
        res.set('X-Over-Split', '1');
        exposedHeaders.push('X-Over-Split');
      }
      const rescuedRule = shippedRescueRule(packages);
      if (rescuedRule != null) {
        res.set('X-Structure-Rescued', rescuedRule);
        exposedHeaders.push('X-Structure-Rescued');
      }
      const warningText = resolveUploadWarning(warnings);
      if (warningText) {
        res.set('X-Warning', warningText);
        exposedHeaders.push('X-Warning');
      }
      res.set('Access-Control-Expose-Headers', exposedHeaders.join(', '));
      first.name = toText(first.name);
      try {
        res.set('File-Name', encodeURIComponent(first.name));
      } catch (err) {
        console.info(`failed to set name ${first.name}`);
        console.error(err);
      }
      res.attachment(`/${first.name}`);
      const bucket = toCardCountBucket(totalCards);
      track('conversion_succeeded', {
        userId: owner != null ? Number(owner) : null,
        anonymousId: this.resolveAnonId(req),
        props: {
          ...this.baseFunnelProps(req),
          card_count_bucket: bucket,
        },
      });
      if (owner != null) {
        await this.usersRepository.incrementCardUsage(owner, totalCards);
      }
      return res.status(200).send(apkg);
    }

    track('conversion_succeeded', {
      userId: owner != null ? Number(owner) : null,
      anonymousId: this.resolveAnonId(req),
      props: {
        ...this.baseFunnelProps(req),
        card_count_bucket: toCardCountBucket(totalCards),
      },
    });
    if (owner != null) {
      await this.usersRepository.incrementCardUsage(owner, totalCards);
    }
    return res
      .status(200)
      .json(
        await this.buildBatchResponse(
          ws,
          resolveUploadWarning(warnings),
          sumDroppedImages(packages),
          totalEmptyBackCount,
          shippedRescueRule(packages),
          sumExpiredNotionImages(packages)
        )
      );
  }

  // Image uploads convert through the same vision pipeline as Photo to Deck
  // (its 5-per-month free quota, unlimited-for-paying gate, and Claude cost all
  // live inside PhotoToFlashcardsUseCase), so dropping a photo on the file
  // uploader succeeds instead of failing with an empty deck. Anonymous and
  // multi-file image uploads never reach here — they keep the image_only_no_text
  // guidance floor.
  private async handleImageUpload(
    req: express.Request,
    res: express.Response,
    owner: string,
    paying: boolean
  ) {
    const file = (req.files as UploadedFile[])[0];
    track('conversion_started', {
      userId: Number(owner),
      anonymousId: this.resolveAnonId(req),
      props: { source: this.resolveUploadSource(req), mode: 'image' },
    });

    const bytes = await readUploadBytes(file);
    const decoded = bytes == null ? null : decodeUploadImage(bytes);
    if (decoded == null) {
      track('conversion_failed', {
        userId: Number(owner),
        anonymousId: this.resolveAnonId(req),
        props: { ...this.baseFunnelProps(req), reason: 'empty_deck' },
      });
      throw new EmptyDeckError();
    }

    const deckName = deckNameFromImageFilename(file.originalname);
    let result: Awaited<ReturnType<PhotoToFlashcardsUseCase['execute']>>;
    try {
      result = await this.photoToFlashcardsUseCase.execute({
        imageBase64: decoded.imageBase64,
        mediaType: decoded.mediaType,
        deckName,
        owner,
        isPaying: paying,
        imageDimensions: { width: decoded.width, height: decoded.height },
        usageSurface: 'photo_to_deck_upload',
      });
    } catch (err) {
      if (this.respondToImageConversionError(req, res, err)) {
        return;
      }
      throw err;
    }

    const apkg = await fs.promises.readFile(result.apkgPath);
    fs.promises.unlink(result.apkgPath).catch(() => undefined);

    res.set('Content-Type', 'application/apkg');
    res.set('Content-Length', Buffer.byteLength(apkg).toString());
    res.set('X-Card-Count', result.cardCount.toString());
    res.set('X-MCQ-Count', result.mcqCount.toString());
    res.set('X-MCQ-Skipped-Count', result.mcqSkippedCount.toString());
    res.set(
      'Access-Control-Expose-Headers',
      'File-Name, X-Card-Count, X-MCQ-Count, X-MCQ-Skipped-Count'
    );
    try {
      res.set('File-Name', encodeURIComponent(deckName));
    } catch (err) {
      console.info(`failed to set name ${deckName}`);
      console.error(err);
    }
    res.attachment(`/${deckName}`);
    track('conversion_succeeded', {
      userId: Number(owner),
      anonymousId: this.resolveAnonId(req),
      props: {
        ...this.baseFunnelProps(req),
        card_count_bucket: toCardCountBucket(result.cardCount),
      },
    });
    return res.status(200).send(apkg);
  }

  private respondToImageConversionError(
    req: express.Request,
    res: express.Response,
    err: unknown
  ): boolean {
    const status = imageConversionErrorStatus(err);
    if (status == null) {
      return false;
    }
    const e = err as Error & {
      code?: string;
      used?: number;
      limit?: number;
    };
    const owner = getOwner(res);
    track('conversion_failed', {
      userId: owner != null ? Number(owner) : null,
      anonymousId: this.resolveAnonId(req),
      props: {
        ...this.baseFunnelProps(req),
        reason: `image_${e.code ?? status}`,
      },
    });
    const body: Record<string, unknown> = {
      code: 'image_conversion_failed',
      message: e.message,
    };
    if (e.used != null) {
      body.used = e.used;
    }
    if (e.limit != null) {
      body.limit = e.limit;
    }
    res.status(status).json(body);
    return true;
  }

  private async buildBatchResponse(
    ws: Workspace,
    warning: string | null = null,
    droppedImageCount = 0,
    emptyBackCount = 0,
    structureRescuedRule?: string,
    expiredNotionImageCount = 0
  ): Promise<BatchUploadResponse> {
    const apkgFilenames = (await fs.promises.readdir(ws.location)).filter(
      (filename) => filename.endsWith('.apkg')
    );
    const decks = apkgFilenames.map((filename) => ({
      name: formatDeckName(filename),
      filename,
      downloadUrl: `/download/${ws.id}/${encodeURIComponent(filename)}`,
    }));
    return {
      kind: 'batch',
      workspaceId: ws.id,
      deckCount: decks.length,
      decks,
      bulkUrl: `/download/${ws.id}/bulk`,
      ...(warning ? { warning } : {}),
      ...(droppedImageCount > 0 ? { droppedImageCount } : {}),
      ...(expiredNotionImageCount > 0 ? { expiredNotionImageCount } : {}),
      ...(emptyBackCount > 0 ? { emptyBackCount } : {}),
      ...(structureRescuedRule == null ? {} : { structureRescuedRule }),
    };
  }

  private resolveAnonId(req: express.Request): string | null {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const anonId = cookies?.anon_id;
    return typeof anonId === 'string' && anonId.length > 0 ? anonId : null;
  }

  private resolveSignupOrigin(req: express.Request): string | null {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    return parseFirstTouch(cookies?.first_touch).signupOrigin;
  }

  private resolvePersistedSource(req: express.Request): UploadSource | null {
    const body = req.body as Record<string, unknown> | undefined;
    return validateUploadSource(body?.source);
  }

  private baseFunnelProps(req: express.Request): Record<string, unknown> {
    return {
      source: this.resolveUploadSource(req),
      input_format: uploadInputFormat(req.files as UploadedFile[] | undefined),
      signup_origin: this.resolveSignupOrigin(req),
    };
  }

  private resolveUploadSource(
    req: express.Request
  ): UploadSource | 'upload' | 'google_drive' {
    const explicit = this.resolvePersistedSource(req);
    if (explicit != null) return explicit;
    if (req.path?.includes('google_drive')) return 'google_drive';
    if (req.path?.includes('dropbox')) return 'dropbox';
    return 'upload';
  }
}

export default UploadService;
