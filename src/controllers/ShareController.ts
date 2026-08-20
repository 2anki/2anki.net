import path from 'node:path';
import { Request, Response } from 'express';
import CreateShareUseCase from '../usecases/share/CreateShareUseCase';
import ResolveShareUseCase from '../usecases/share/ResolveShareUseCase';
import RevokeShareUseCase from '../usecases/share/RevokeShareUseCase';
import ShareService from '../services/ShareService';
import StorageHandler from '../lib/storage/StorageHandler';
import ApkgPreviewService from '../services/ApkgPreviewService/ApkgPreviewService';
import DownloadService from '../services/DownloadService';
import { buildContentDisposition } from '../lib/buildContentDisposition';
import { getSafeFilename } from '../lib/getSafeFilename';

const NOINDEX = 'noindex';

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

function clampPageSize(
  input: unknown,
  defaultSize = DEFAULT_PAGE_SIZE
): number {
  const raw = typeof input === 'string' ? input : '';
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultSize;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function clampCursor(input: unknown): number {
  const raw = typeof input === 'string' ? input : '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseDeckId(input: unknown): number | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

class ShareController {
  constructor(
    private readonly createUseCase: CreateShareUseCase,
    private readonly resolveUseCase: ResolveShareUseCase,
    private readonly revokeUseCase: RevokeShareUseCase,
    private readonly shareService: ShareService,
    private readonly storage: StorageHandler,
    private readonly previewService: ApkgPreviewService,
    private readonly downloadService: DownloadService
  ) {}

  async createShare(req: Request, res: Response) {
    const { owner } = res.locals;
    if (owner == null) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const uploadKey = req.body?.upload_key;
    if (typeof uploadKey !== 'string' || uploadKey.trim().length === 0) {
      res.status(400).json({ message: 'upload_key is required' });
      return;
    }

    try {
      const result = await this.createUseCase.execute(owner, uploadKey.trim());
      res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'Upload not found') {
        res.status(404).json({ message: 'Upload not found.' });
        return;
      }
      console.error('[ShareController.createShare]', error);
      res.status(500).json({ message: 'Failed to create share link.' });
    }
  }

  async getActiveSharesForOwner(req: Request, res: Response) {
    const { owner } = res.locals;
    if (owner == null) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    try {
      const shares = await this.shareService.findAllByOwner(owner);
      const result = shares.map((s) => ({
        token: s.token,
        upload_key: s.upload_key,
        url: this.shareService.buildShareUrl(s.token),
        created_at: s.created_at,
        view_count: s.view_count,
      }));
      res.json(result);
    } catch (error) {
      console.error('[ShareController.getActiveSharesForOwner]', error);
      res.status(500).json({ message: 'Failed to retrieve shares.' });
    }
  }

  private async loadParsedForToken(token: string, res: Response) {
    const share = await this.resolveUseCase.execute(token);
    if (share == null) {
      res
        .status(404)
        .json({ message: 'This link was turned off by the owner.' });
      return null;
    }

    try {
      const fileOutput = await this.storage.getFileContents(share.upload_key);
      if (fileOutput.Body == null) {
        res.status(404).json({ message: 'This deck is no longer available.' });
        return null;
      }
      const cacheKey = `share:${token}`;
      const parsed = await this.previewService.parse(
        cacheKey,
        fileOutput.Body as Buffer
      );
      return { share, parsed };
    } catch (error) {
      if (this.downloadService.isMissingDownloadError(error)) {
        res.status(404).json({ message: 'This deck is no longer available.' });
        return null;
      }
      throw error;
    }
  }

  async getMeta(req: Request, res: Response) {
    const { token } = req.params;
    res.setHeader('X-Robots-Tag', NOINDEX);
    try {
      const loaded = await this.loadParsedForToken(token, res);
      if (loaded == null) return;

      await this.shareService.recordView(loaded.share);
      res.json(this.previewService.getMeta(loaded.parsed));
    } catch (error) {
      console.error('[ShareController.getMeta]', error);
      res.status(500).json({ message: 'Failed to load deck metadata.' });
    }
  }

  async getCards(req: Request, res: Response) {
    const { token } = req.params;
    res.setHeader('X-Robots-Tag', NOINDEX);
    try {
      const loaded = await this.loadParsedForToken(token, res);
      if (loaded == null) return;

      const cursor = clampCursor(req.query.cursor);
      const pageSize = clampPageSize(req.query.page_size);
      const deckId = parseDeckId(req.query.deck_id);
      const mediaBaseUrl = `/api/shares/${encodeURIComponent(token)}/media/`;
      res.json(
        this.previewService.getCardsPage(
          loaded.parsed,
          cursor,
          pageSize,
          mediaBaseUrl,
          deckId
        )
      );
    } catch (error) {
      console.error('[ShareController.getCards]', error);
      res.status(500).json({ message: 'Failed to load cards.' });
    }
  }

  async getMedia(req: Request, res: Response) {
    const { token, name } = req.params;
    res.setHeader('X-Robots-Tag', NOINDEX);
    try {
      const loaded = await this.loadParsedForToken(token, res);
      if (loaded == null) return;

      if (!name) {
        res.status(400).json({ message: 'Missing media name.' });
        return;
      }

      const buffer = this.previewService.getMediaEntry(loaded.parsed, name);
      if (buffer == null) {
        res.status(404).send();
        return;
      }
      res.setHeader('Content-Type', guessContentType(name));
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buffer);
    } catch (error) {
      console.error('[ShareController.getMedia]', error);
      res.status(500).json({ message: 'Failed to load media.' });
    }
  }

  async download(req: Request, res: Response) {
    const { token } = req.params;
    res.setHeader('X-Robots-Tag', NOINDEX);
    try {
      const share = await this.resolveUseCase.execute(token);
      if (share == null) {
        res
          .status(404)
          .json({ message: 'This link was turned off by the owner.' });
        return;
      }

      const fileOutput = await this.storage.getFileContents(share.upload_key);
      if (fileOutput.Body == null) {
        res.status(404).json({ message: 'This deck is no longer available.' });
        return;
      }

      const dbName = await this.downloadService.getFilename(
        String(share.owner),
        share.upload_key
      );
      const basename = dbName ? getSafeFilename(dbName) : share.upload_key;
      const filename = basename.endsWith('.apkg')
        ? basename
        : `${basename}.apkg`;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', buildContentDisposition(filename));
      res.send(fileOutput.Body);
    } catch (error) {
      if (this.downloadService.isMissingDownloadError(error)) {
        res.status(404).json({ message: 'This deck is no longer available.' });
        return;
      }
      console.error('[ShareController.download]', error);
      res.status(500).json({ message: 'Download failed.' });
    }
  }

  async revokeShare(req: Request, res: Response) {
    const { owner } = res.locals;
    if (owner == null) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const { token } = req.params;
    try {
      const revoked = await this.revokeUseCase.execute(token, owner);
      if (revoked) {
        res.status(204).send();
      } else {
        res.status(404).json({ message: 'Share not found.' });
      }
    } catch (error) {
      console.error('[ShareController.revokeShare]', error);
      res.status(500).json({ message: 'Failed to revoke share.' });
    }
  }
}

export default ShareController;
