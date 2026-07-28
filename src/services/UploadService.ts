import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { IUploadRepository } from '../data_layer/UploadRespository';
import JobRepository from '../data_layer/JobRepository';
import UsersRepository from '../data_layer/UsersRepository';
import { ISettingsRepository } from '../data_layer/SettingsRepository';
import { IConversionOutputStatsRepository } from '../data_layer/ConversionOutputStatsRepository';
import { IParsePathSignatureRepository } from '../data_layer/ParsePathSignatureRepository';
import ErrorHandler from '../routes/middleware/ErrorHandler';
import CardOption from '../lib/parser/Settings';
import Workspace from '../lib/parser/WorkSpace';
import { logEmptyBackAttribution } from '../lib/parser/logEmptyBackAttribution';
import StorageHandler from '../lib/storage/StorageHandler';
import { UploadedFile } from '../lib/storage/types';
import GeneratePackagesUseCase from '../usecases/uploads/GeneratePackagesUseCase';
import { toText } from './NotionService/BlockHandler/helpers/deckNameToText';
import { isPaying } from '../lib/isPaying';
import { isLimitError } from '../lib/misc/isLimitError';
import { handleUploadLimitError } from '../controllers/Upload/helpers/handleUploadLimitError';
import { getUploadValidationError } from '../lib/upload/getUploadValidationError';
import { isImageOnlyUpload } from '../lib/upload/isImageOnlyUpload';
import { EmptyDeckError } from '../usecases/jobs/EmptyDeckError';
import { UploadFileUnavailableError } from '../usecases/uploads/UploadFileUnavailableError';
import { isExpectedClientFault } from '../lib/misc/isExpectedClientFault';
import type { DeckScore } from '../lib/parser/scoreCandidateDeck';
import type { InducedRescue } from '../lib/parser/induction/candidateRules';
import {
  CONVERSION_TRUNCATED_MESSAGE,
  FileConversionError,
} from '../infrastracture/adapters/fileConversion/claudeFileConversion';
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
import { formatDeckName } from '../lib/formatDeckName';
import {
  CheckMonthlyCardLimitUseCase,
  MonthlyLimitError,
  AnonymousCardCapError,
  ANONYMOUS_CARD_CAP,
  MONTHLY_CARD_LIMIT,
} from '../usecases/users/CheckMonthlyCardLimitUseCase';
import {
  ApiCardLimitError,
  CheckApiCardLimitUseCase,
} from '../usecases/developer/CheckApiCardLimitUseCase';
import {
  ApiUsageWarner,
  RecordApiCardUsageUseCase,
} from '../usecases/developer/RecordApiCardUsageUseCase';
import type { IApiKeyUsageRepository } from '../data_layer/ApiKeyUsageRepository';
import {
  ResolvedDeveloperTier,
  SANDBOX_TIER,
} from '../usecases/developer/ResolveDeveloperTierUseCase';
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
  emptyBackCount?: number;
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

// The extension of the first uploaded file, lowercased. A shape metric, never
// the filename itself — see .claude/rules/support-confidentiality.md.
//
// Allowlisted rather than passed through: the value is a cohort key, and an
// unbounded one lets any upload mint a cohort of size one. Anything unrecognised
// buckets into 'other' so the cardinality stays fixed.
const KNOWN_INPUT_FORMATS = new Set([
  'zip',
  'html',
  'htm',
  'md',
  'markdown',
  'csv',
  'tsv',
  'xlsx',
  'xls',
  'pdf',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'txt',
  'apkg',
  'opml',
  'epub',
  'xml',
  'json',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
]);

function uploadInputFormat(files: UploadedFile[] | undefined): string {
  const name = files?.[0]?.originalname;
  if (typeof name !== 'string') return 'unknown';
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'unknown';
  const ext = name.slice(dot + 1).toLowerCase();
  return KNOWN_INPUT_FORMATS.has(ext) ? ext : 'other';
}

function sumDroppedImages(packages: { droppedImageCount?: number }[]): number {
  return packages.reduce((sum, p) => sum + (p.droppedImageCount ?? 0), 0);
}

function hasSessionToken(req: express.Request): boolean {
  const token = (req.cookies as Record<string, unknown> | undefined)?.token;
  return typeof token === 'string' && token.length > 0;
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
      !entry.name.endsWith('.apkg')
    ) {
      results.push(entry.name);
    }
  }
  return results;
}

function resolveAsyncFailureReason(
  err: unknown,
  message: string,
  jobId: string
): string {
  if (err instanceof MonthlyLimitError) {
    return JSON.stringify({
      code: 'monthly_limit',
      cards_used: err.cards_used,
      limit: err.limit,
      reset_on: err.reset_on,
    });
  }
  if (err instanceof ApiCardLimitError) {
    return JSON.stringify({
      code: 'api_card_limit',
      cards_used: err.cards_used,
      limit: err.limit,
      tier: err.tier_key,
      reset_on: err.reset_on,
    });
  }
  const isParserCrash =
    err instanceof Error &&
    (err as Error & { code?: string }).code === 'PARSER_CRASH';
  if (err instanceof EmptyDeckError || isParserCrash || message.trim() === '') {
    return jobFailureReasonFromError(err, jobId);
  }
  return message;
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
      const head = contents.slice(0, 1000).toString('utf8');
      const hasDisplayContents = head.includes('display:contents');
      const hasToggleClass = head.includes('class="toggle"');
      const hasDetails = head.includes('<details');
      console.info(`  snippet=${JSON.stringify(head.slice(0, 300))}`);
      console.info(
        `  display:contents=${hasDisplayContents} .toggle=${hasToggleClass} <details=${hasDetails}`
      );
    } catch (readErr) {
      console.error(`  could not read file: ${readErr}`);
    }
  }
}

class UploadService {
  getUploadsByOwner(owner: number) {
    return this.uploadRepository.getUploadsByOwner(owner);
  }

  constructor(
    private readonly uploadRepository: IUploadRepository,
    private readonly jobRepository: JobRepository,
    private readonly usersRepository: UsersRepository,
    private readonly settingsRepository?: ISettingsRepository,
    private readonly conversionOutputStatsRepository?: IConversionOutputStatsRepository,
    private readonly parsePathSignatureRepository?: IParsePathSignatureRepository,
    private readonly apiKeyUsageRepository?: IApiKeyUsageRepository,
    private readonly apiUsageWarner?: ApiUsageWarner,
    private readonly conversionRuleScoresRepository?: IConversionRuleScoresRepository
  ) {}

  private apiTierOf(res: express.Response): ResolvedDeveloperTier | null {
    if (res.locals.api_key_auth !== true) {
      return null;
    }
    return (res.locals.developer_tier as ResolvedDeveloperTier) ?? SANDBOX_TIER;
  }

  private async checkApiCardLimit(
    res: express.Response,
    owner: string | number | null | undefined,
    totalCards: number
  ): Promise<void> {
    const tier = this.apiTierOf(res);
    if (tier == null || owner == null) {
      return;
    }
    if (this.apiKeyUsageRepository == null) {
      console.error(
        '[api-tier] api_key_auth request but no usage repository wired — cap not enforced'
      );
      return;
    }
    await new CheckApiCardLimitUseCase(this.apiKeyUsageRepository).execute({
      userId: Number(owner),
      candidateCardCount: totalCards,
      tier,
    });
  }

  private async recordApiCardUsage(
    res: express.Response,
    owner: string | number | null | undefined,
    totalCards: number
  ): Promise<void> {
    const tier = this.apiTierOf(res);
    if (tier == null || owner == null || this.apiKeyUsageRepository == null) {
      return;
    }
    const email = typeof res.locals.email === 'string' ? res.locals.email : '';
    await new RecordApiCardUsageUseCase(
      this.apiKeyUsageRepository,
      this.apiUsageWarner ?? (async () => {})
    ).execute({
      userId: Number(owner),
      email,
      cards: totalCards,
      tier,
    });
  }

  // Every conversion is scored, not just fallbacks — without the baseline there
  // is nothing to compare a rescued deck against. Fire and forget: a metrics
  // write must never fail a conversion the user is waiting on.
  // The entry point, not the engine. resolveUploadSource already distinguishes
  // web/app/dropbox/google_drive from the request; the two machine callers are
  // only visible on res.locals, and an MCP request also carries api_key_auth,
  // so MCP is checked first or every MCP conversion would record as 'api'.
  private resolveScoreSource(
    req: express.Request,
    res: express.Response
  ): ConversionScoreSource {
    if (res.locals.mcp_auth === true) return 'mcp';
    if (res.locals.api_key_auth === true) return 'api';
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
    if (this.conversionRuleScoresRepository == null) return;
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
      ?.record('upload', { decks: packages.length, cards, emptyBack })
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
        ?.record(parsePaths)
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
    if (!fs.existsSync(workspaceDir)) {
      res
        .status(409)
        .json({ error: 'Workspace files are no longer available' });
      return;
    }

    const claimed = await this.jobRepository.restartJob(job.object_id, owner);
    if (claimed == null) {
      res.status(409).json({ error: 'This job is already running' });
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
      await this.jobRepository.updateJobStatus(
        job.object_id,
        owner,
        'failed',
        resolveAsyncFailureReason(err, err.message, job.object_id)
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

    const deckInfoArrays: DeckInfo[][] = [];
    for (const htmlFile of htmlFiles) {
      const content = await fs.promises.readFile(htmlFile, 'utf8');
      const deckInfo = await generateDeckInfo(
        content,
        mediaFiles,
        undefined,
        onProgress
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
        await this.settingsRepository?.attachCustomTemplates(
          String(owner),
          settings
        );
      }

      track('upload_started', {
        userId: owner != null ? Number(owner) : null,
        anonymousId: this.resolveAnonId(req),
        props: {
          source: this.resolveUploadSource(req),
          device: classifyDevice(req.headers?.['user-agent']),
          signup_origin: this.resolveSignupOrigin(req),
        },
      });

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
      if (err instanceof ApiCardLimitError) {
        const owner = getOwner(res);
        track('conversion_failed', {
          userId: owner != null ? Number(owner) : null,
          anonymousId: this.resolveAnonId(req),
          props: {
            source: this.resolveUploadSource(req),
            reason: 'api_card_limit',
            signup_origin: this.resolveSignupOrigin(req),
          },
        });
        return res.status(402).json({
          message: `Monthly API card limit reached (${err.cards_used} of ${err.limit} on the ${err.tier_key} tier), so this deck wasn't created. Upgrade at https://2anki.net/pricing?from=api or wait for the reset on ${err.reset_on.slice(0, 10)}.`,
          cards_used: err.cards_used,
          limit: err.limit,
          tier: err.tier_key,
          reset_on: err.reset_on,
          upgrade_url: 'https://2anki.net/pricing?from=api',
        });
      }
      if (err instanceof MonthlyLimitError) {
        const owner = getOwner(res);
        const userId = owner != null ? Number(owner) : null;
        const source = this.resolveUploadSource(req);
        const anonymousId = this.resolveAnonId(req);
        track('conversion_failed', {
          userId,
          anonymousId,
          props: {
            source,
            reason: 'monthly_limit',
            signup_origin: this.resolveSignupOrigin(req),
          },
        });
        track('paywall_shown', {
          userId,
          anonymousId,
          props: { source, kind: 'card_count' },
        });
        if (res.locals.api_key_auth === true) {
          return res.status(402).json({
            message: `Monthly card limit reached (${err.cards_used} of ${err.limit}), so this deck wasn't created. Upgrade at https://2anki.net/pricing?from=api or wait for the reset on ${err.reset_on.slice(0, 10)}.`,
            cards_used: err.cards_used,
            limit: err.limit,
            reset_on: err.reset_on,
            upgrade_url: 'https://2anki.net/pricing?from=api',
          });
        }
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
            source,
            reason: 'anonymous_cap',
            signup_origin: this.resolveSignupOrigin(req),
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
            source: this.resolveUploadSource(req),
            reason: 'upload_incomplete',
            signup_origin: this.resolveSignupOrigin(req),
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

  private async handleAsyncUpload(
    req: express.Request,
    res: express.Response,
    settings: CardOption,
    ws: Workspace,
    owner: string,
    paying: boolean
  ) {
    const files = req.files as UploadedFile[];
    const title =
      files.length === 1 ? files[0].originalname : `${files.length} files`;
    await this.jobRepository.create(ws.id, owner, title, 'claude');

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
    useCase
      .execute(
        paying,
        req.files as UploadedFile[],
        settings,
        ws,
        async (step) => {
          await this.jobRepository.updateJobStatus(ws.id, owner, step);
        },
        ownerId
      )
      .then(async ({ packages }) => {
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
          await this.checkApiCardLimit(res, owner, totalCards);
          await this.promoteClaudeJobToUpload(
            ws.id,
            ws.location,
            owner,
            totalCards,
            source,
            paying
          );
          await this.recordApiCardUsage(res, owner, totalCards);
          track('conversion_succeeded', {
            userId: Number(owner),
            anonymousId: this.resolveAnonId(req),
            props: {
              source: this.resolveUploadSource(req),
              card_count_bucket: this.toCardCountBucket(totalCards),
              signup_origin: this.resolveSignupOrigin(req),
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
        const message = err instanceof Error ? err.message : String(err);
        const isExpectedState =
          err instanceof EmptyDeckError ||
          err instanceof ClaudeParseError ||
          err instanceof ClaudeLargeSectionError ||
          (err instanceof FileConversionError &&
            err.message === CONVERSION_TRUNCATED_MESSAGE) ||
          err instanceof ImageOnlyContentError ||
          (err instanceof Error && isExpectedClientFault(err)) ||
          (err instanceof Error && isPdfPasswordSentinel(err.message)) ||
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
        const reason = resolveAsyncFailureReason(err, message, ws.id);
        await this.jobRepository.updateJobStatus(
          ws.id,
          owner,
          'failed',
          reason
        );
      });

    return res.status(202).json({ jobId: ws.id });
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
    const { packages, warnings } = await useCase.execute(
      paying,
      req.files as UploadedFile[],
      settings,
      ws
    );

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
      track('conversion_failed', {
        userId: owner != null ? Number(owner) : null,
        anonymousId: this.resolveAnonId(req),
        props: {
          source: this.resolveUploadSource(req),
          reason: 'empty_deck',
          signup_origin: this.resolveSignupOrigin(req),
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
      await this.checkApiCardLimit(res, owner, totalCards);
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
      if (totalEmptyBackCount > 0) {
        res.set('X-Empty-Back-Count', totalEmptyBackCount.toString());
        exposedHeaders.push('X-Empty-Back-Count');
      }
      if (packages.some((p) => p.overSplit)) {
        res.set('X-Over-Split', '1');
        exposedHeaders.push('X-Over-Split');
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
      const uploadSource = this.resolveUploadSource(req);
      const bucket = this.toCardCountBucket(totalCards);
      track('conversion_succeeded', {
        userId: owner != null ? Number(owner) : null,
        anonymousId: this.resolveAnonId(req),
        props: {
          source: uploadSource,
          card_count_bucket: bucket,
          signup_origin: this.resolveSignupOrigin(req),
        },
      });
      if (owner != null) {
        await this.usersRepository.incrementCardUsage(owner, totalCards);
        await this.recordApiCardUsage(res, owner, totalCards);
      }
      return res.status(200).send(apkg);
    }

    track('conversion_succeeded', {
      userId: owner != null ? Number(owner) : null,
      anonymousId: this.resolveAnonId(req),
      props: {
        source: this.resolveUploadSource(req),
        card_count_bucket: this.toCardCountBucket(totalCards),
        signup_origin: this.resolveSignupOrigin(req),
      },
    });
    if (owner != null) {
      await this.usersRepository.incrementCardUsage(owner, totalCards);
      await this.recordApiCardUsage(res, owner, totalCards);
    }
    return res
      .status(200)
      .json(
        await this.buildBatchResponse(
          ws,
          resolveUploadWarning(warnings),
          sumDroppedImages(packages),
          totalEmptyBackCount
        )
      );
  }

  private async buildBatchResponse(
    ws: Workspace,
    warning: string | null = null,
    droppedImageCount = 0,
    emptyBackCount = 0
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
      ...(emptyBackCount > 0 ? { emptyBackCount } : {}),
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

  private resolveUploadSource(
    req: express.Request
  ): UploadSource | 'upload' | 'google_drive' {
    const explicit = this.resolvePersistedSource(req);
    if (explicit != null) return explicit;
    if (req.path?.includes('google_drive')) return 'google_drive';
    if (req.path?.includes('dropbox')) return 'dropbox';
    return 'upload';
  }

  private toCardCountBucket(count: number): '<50' | '50-499' | '500+' {
    if (count < 50) return '<50';
    if (count < 500) return '50-499';
    return '500+';
  }
}

export default UploadService;
