import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import type { Readable } from 'node:stream';
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
        const basename = dbName
          ? getSafeFilename(dbName)
          : key.endsWith('.apkg')
            ? key
            : `${key}.apkg`;
        const filename = basename.endsWith('.apkg')
          ? basename
          : `${basename}.apkg`;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', buildContentDisposition(filename));
        if (stored.contentLength != null) {
          res.setHeader('Content-Length', String(stored.contentLength));
        }
        this.pipeStoredObject(stored.body, res, owner);
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

  // A client that gives up mid-download (Safari retried a 951 MB deck a dozen
  // times on 2026-09-20) has to stop the pull from storage as well, or every
  // abandoned attempt still costs a full object read into the box.
  private pipeStoredObject(body: Readable, res: Response, owner: unknown) {
    res.on('close', () => {
      if (!body.destroyed) {
        body.destroy();
      }
    });
    body.on('error', (error) => {
      console.error('Download stream failed', {
        owner,
        name: (error as { name?: string })?.name,
      });
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res
        .status(503)
        .send('Storage is busy right now. Try the download again in a moment.');
    });
    body.pipe(res);
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
