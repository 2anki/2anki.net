import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import StorageHandler from '../lib/storage/StorageHandler';
import DownloadService from '../services/DownloadService';
import { canAccess } from '../lib/misc/canAccess';
import { DownloadPage } from '../ui/pages/DownloadPage';
import { buildContentDisposition } from '../lib/buildContentDisposition';
import { getSafeFilename } from '../lib/getSafeFilename';
import { formatDeckName } from '../lib/formatDeckName';
import JobRepository from '../data_layer/JobRepository';
import { track } from '../services/events/track';
import { createZipArchive } from '../lib/archiver/createZipArchive';

export interface DownloadFileViewModel {
  originalName: string;
  displayName: string;
  sizeBytes: number;
}

export interface DownloadPageViewModel {
  id: string;
  sourceTitle: string | null;
  files: DownloadFileViewModel[];
  totalSizeBytes: number;
}

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isValidWorkspaceId(id: string): boolean {
  return WORKSPACE_ID_PATTERN.test(id);
}

const withApkgExtension = (name: string): string =>
  name.endsWith('.apkg') ? name : `${name}.apkg`;

const downloadFilename = (key: string, dbName: string | null): string =>
  withApkgExtension(dbName ? getSafeFilename(dbName) : key);

function resolveDownloadIdentity(
  req: Request,
  res: Response
): { userId: number | null; anonymousId: string | null } {
  const owner = res.locals?.owner as unknown;
  const userId =
    typeof owner === 'number'
      ? owner
      : typeof owner === 'string' && Number.isFinite(Number(owner))
        ? Number(owner)
        : null;
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const anonId = cookies?.anon_id;
  const anonymousId =
    typeof anonId === 'string' && anonId.length > 0 ? anonId : null;
  return { userId, anonymousId };
}

const STALE_SPOOL_MS = 60 * 60 * 1000;

// A spool file outlives its download only when the process died mid-serve.
// Pruning by age on the next download keeps the dir self-contained; a file
// still being served survives its own unlink through the open descriptor.
async function pruneStaleSpoolFiles(spoolDir: string): Promise<void> {
  try {
    const cutoff = Date.now() - STALE_SPOOL_MS;
    const names = await fs.promises.readdir(spoolDir);
    await Promise.all(
      names.map(async (name) => {
        const filePath = path.join(spoolDir, name);
        const { mtimeMs } = await fs.promises.stat(filePath);
        if (mtimeMs < cutoff) {
          await fs.promises.rm(filePath, { force: true });
        }
      })
    );
  } catch {
    // Pruning is opportunistic; the download itself never waits on it.
  }
}

class DownloadController {
  constructor(
    private readonly service: DownloadService,
    private readonly jobRepository?: JobRepository
  ) {}

  async getFile(req: Request, res: Response, storage: StorageHandler) {
    const { key } = req.params;

    if (!this.service.isValidKey(key)) {
      return res.status(400).send();
    }

    console.debug(`download ${key}`);
    const { owner } = res.locals;
    try {
      const stored = await this.service.getFileStream(owner, key, storage);
      if (stored) {
        const dbName = await this.service.getFilename(owner, key);
        const filename = downloadFilename(key, dbName);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', buildContentDisposition(filename));
        await this.serveStoredObject(stored.body, res, owner);
        return;
      }
      console.info('Download link expired', { owner });
      res
        .status(404)
        .send(
          "Download link expire, try converting again <a href='/upload'>upload</a>"
        );
    } catch (error) {
      if (this.service.isMissingDownloadError(error)) {
        this.service.deleteMissingFile(owner, key);
        res.redirect('/downloads');
        return;
      }
      if (this.service.isTransientStorageError(error)) {
        console.info('Download storage transient error', {
          owner,
          name: (error as { name?: string })?.name,
        });
        res
          .status(503)
          .send(
            'Storage is busy right now. Try the download again in a moment.'
          );
        return;
      }
      console.info('Download failed');
      console.error(error);
      res
        .status(404)
        .send(
          "Download link expire, try converting again <a href='/upload'>upload</a>"
        );
    }
  }

  // The object is spooled to disk at storage speed and served from the file.
  // Piping storage straight to the client let a slow reader (30 KB/s on a
  // 76 MB deck, 2026-09-28) hold the storage socket idle until the upstream
  // dropped it mid-object, truncating every attempt (#4561). A client that
  // gives up at any point stops the pull and drops the spool (#4544), and
  // only the spool file, never the whole object, sits on the box. Files an
  // earlier process left behind are pruned on the next download, so the spool
  // dir never relies on another sweeper; an unlinked file stays readable
  // through its open descriptor, so pruning cannot cut a slow download short.
  private async serveStoredObject(
    body: Readable,
    res: Response,
    owner: unknown
  ) {
    const spoolDir = path.join(process.env.WORKSPACE_BASE!, 'download-spool');
    const spoolPath = path.join(spoolDir, `${randomUUID()}.apkg`);
    const discardSpool = () =>
      fs.promises.rm(spoolPath, { force: true }).catch(() => undefined);
    let clientGone = false;
    let file: fs.ReadStream | undefined;
    res.on('close', () => {
      clientGone = true;
      if (!body.destroyed) {
        body.destroy();
      }
      if (file && !file.destroyed) {
        file.destroy();
      }
      void discardSpool();
    });
    const spoolStartedAt = Date.now();
    try {
      await fs.promises.mkdir(spoolDir, { recursive: true });
      void pruneStaleSpoolFiles(spoolDir);
      await pipeline(body, fs.createWriteStream(spoolPath, { flags: 'wx' }));
    } catch (error) {
      await discardSpool();
      if (clientGone) {
        console.info('Download abandoned while spooling', { owner });
        return;
      }
      console.error('Download spool failed', {
        owner,
        name: (error as { name?: string })?.name,
      });
      res
        .status(503)
        .send('Storage is busy right now. Try the download again in a moment.');
      return;
    }
    if (clientGone) {
      await discardSpool();
      return;
    }

    const { size } = await fs.promises.stat(spoolPath);
    console.info('Download spooled', {
      owner,
      bytes: size,
      spoolMs: Date.now() - spoolStartedAt,
    });
    if (clientGone) {
      await discardSpool();
      return;
    }
    if (!res.headersSent) {
      res.setHeader('Content-Length', String(size));
    }
    file = fs.createReadStream(spoolPath);
    if (clientGone) {
      file.destroy();
      await discardSpool();
      return;
    }
    file.on('error', (error) => {
      console.error('Download spool read failed', {
        owner,
        name: (error as { name?: string })?.name,
      });
      res.destroy(error);
    });
    file.pipe(res);
  }

  async getDownloadPage(req: Request, res: Response) {
    const { id } = req.params;
    if (!isValidWorkspaceId(id)) {
      return res.status(404).end();
    }
    const workspaceBase = process.env.WORKSPACE_BASE!;
    const workspace = path.join(workspaceBase, id);

    if (
      !fs.existsSync(workspace) ||
      !canAccess(workspace, workspaceBase) ||
      !fs.statSync(workspace).isDirectory()
    ) {
      return res.status(404).end();
    }

    try {
      const allFiles = await fs.promises.readdir(workspace);
      const apkgFiles = allFiles.filter((f) => f.endsWith('.apkg'));

      const sourceTitle = await this.resolveSourceTitle(id);

      const fileViewModels = await Promise.all(
        apkgFiles.map(async (filename) => {
          const filePath = path.join(workspace, filename);
          const stat = await fs.promises.stat(filePath);
          return {
            originalName: filename,
            displayName: formatDeckName(filename),
            sizeBytes: stat.size,
          };
        })
      );

      const totalSizeBytes = fileViewModels.reduce(
        (sum, f) => sum + f.sizeBytes,
        0
      );

      const viewModel: DownloadPageViewModel = {
        id,
        sourceTitle,
        files: fileViewModels,
        totalSizeBytes,
      };

      const page = DownloadPage(viewModel);
      res.send(page);
    } catch (err) {
      console.error(err);
      res.status(500).send('Error reading directory');
    }
  }

  private async resolveSourceTitle(id: string): Promise<string | null> {
    if (this.jobRepository == null) {
      return null;
    }
    try {
      const job = await this.jobRepository.findJobByObjectId(id);
      return job?.title ?? null;
    } catch {
      return null;
    }
  }

  getLocalFile(req: Request, res: Response) {
    const { id, filename } = req.params;
    if (!isValidWorkspaceId(id)) {
      return res.status(404).end();
    }
    const workspaceBase = process.env.WORKSPACE_BASE!;
    const workspace = path.join(workspaceBase, id);
    const filePath = path.join(workspace, filename);

    if (!canAccess(filePath, workspace) || !fs.existsSync(filePath)) {
      return res.status(404).end();
    }
    const identity = resolveDownloadIdentity(req, res);
    track('deck_downloaded', {
      userId: identity.userId,
      anonymousId: identity.anonymousId,
      props: { workspace_id: id, bulk: false },
    });
    return res.sendFile(filePath);
  }

  async getBulkDownload(req: Request, res: Response) {
    const { id } = req.params;
    if (!isValidWorkspaceId(id)) {
      return res.status(404).end();
    }
    const workspaceBase = process.env.WORKSPACE_BASE!;
    const workspace = path.join(workspaceBase, id);

    if (
      !fs.existsSync(workspace) ||
      !canAccess(workspace, workspaceBase) ||
      !fs.statSync(workspace).isDirectory()
    ) {
      return res.status(404).end();
    }

    try {
      const allFiles = await fs.promises.readdir(workspace);
      const ankiFiles = allFiles.filter((file) => file.endsWith('.apkg'));

      if (ankiFiles.length === 0) {
        return res.status(404).send('No Anki deck files found');
      }

      const archive = createZipArchive({ zlib: { level: 9 } });

      archive.on('error', (err) => {
        console.error('Archive error:', err);
        if (res.headersSent) {
          archive.abort();
          res.destroy(err);
          return;
        }
        res.status(500).send('Error creating bulk download');
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        buildContentDisposition(`anki-decks-${id}.zip`)
      );

      const identity = resolveDownloadIdentity(req, res);
      track('deck_downloaded', {
        userId: identity.userId,
        anonymousId: identity.anonymousId,
        props: { workspace_id: id, bulk: true, file_count: ankiFiles.length },
      });

      archive.pipe(res);
      ankiFiles.forEach((file) => {
        const filePath = path.join(workspace, file);
        if (fs.existsSync(filePath)) {
          archive.file(filePath, { name: file });
        }
      });

      archive.finalize();
    } catch (err) {
      console.error('Bulk download failed:', err);
      if (!res.headersSent) {
        res.status(500).send('Error creating bulk download');
      }
    }
  }
}

export default DownloadController;
