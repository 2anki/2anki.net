import { HttpCodedError } from '../../lib/errors/HttpCodedError';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

import { CREATE_DECK_DIR } from '../../lib/constants';
import { FREE_TIER_IMAGE_LIMIT, ImageLimitError } from './ImageLimitError';

export interface OcclusionRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  shape?: 'rect' | 'ellipse' | 'polygon';
  points?: { x: number; y: number }[];
  groupId?: string;
}

export interface ImageOcclusionImage {
  imageName: string;
  header: string;
  rects: OcclusionRect[];
  s3Key?: string;
}

export interface CreateImageOcclusionDeckInput {
  deckName: string;
  mode: 'hide_all' | 'hide_one';
  images: ImageOcclusionImage[];
  imageFiles: { name: string; path: string }[];
  isPaying: boolean;
  ownerId: number | null;
}

// The client names the S3 object to read, so a key is honoured only inside
// the caller's own draft folder. Without this, any key in the bucket, another
// user's upload included, could be pulled into a deck the caller downloads.
function assertOwnDraftKey(key: string, ownerId: number | null): void {
  const prefix = `io-drafts/${ownerId}/`;
  if (
    ownerId == null ||
    !key.startsWith(prefix) ||
    key.slice(prefix.length).includes('/') ||
    key.includes('..')
  ) {
    throw new HttpCodedError(
      'This image is not part of your draft.',
      400,
      'invalid_image_key'
    );
  }
}

function isMissingObject(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

function findPython(): string {
  const envOverride = process.env.PYTHON ?? process.env.ANKI_PYTHON;
  if (envOverride) {
    return envOverride;
  }

  const venvPython = path.join(CREATE_DECK_DIR, 'venv', 'bin', 'python3');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  if (process.platform === 'win32') {
    const localPython = path.join(
      homedir(),
      'AppData',
      'Local',
      'Programs',
      'Python',
      'Python38',
      'python.exe'
    );
    if (fs.existsSync(localPython)) return localPython;
    for (const cmd of ['py', 'python', 'python3']) {
      try {
        execFileSync(cmd, ['--version'], { stdio: 'ignore' });
        return cmd;
      } catch {
        // continue
      }
    }
  }

  for (const p of [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  ]) {
    if (fs.existsSync(p)) return p;
  }

  return 'python3';
}

const IO_SCRIPT_PATH = path.join(CREATE_DECK_DIR, 'create_io_deck.py');

export class CreateImageOcclusionDeckUseCase {
  async execute(input: CreateImageOcclusionDeckInput): Promise<string> {
    if (!input.isPaying && input.images.length > FREE_TIER_IMAGE_LIMIT) {
      throw new ImageLimitError(FREE_TIER_IMAGE_LIMIT);
    }

    for (const img of input.images) {
      if (img.s3Key != null) assertOwnDraftKey(img.s3Key, input.ownerId);
    }

    const workspaceDir = path.join(os.tmpdir(), `io-${randomUUID()}`);
    fs.mkdirSync(workspaceDir, { recursive: true });

    try {
      for (const imageFile of input.imageFiles) {
        const safeName = path.basename(imageFile.name);
        fs.copyFileSync(imageFile.path, path.join(workspaceDir, safeName));
      }

      const imagesWithS3 = input.images.filter((img) => img.s3Key != null);
      if (imagesWithS3.length > 0) {
        const StorageHandler = (
          await import('../../lib/storage/StorageHandler')
        ).default;
        const storage = new StorageHandler();
        for (const img of imagesWithS3) {
          const safeName = path.basename(img.imageName);
          const dest = path.join(workspaceDir, safeName);
          if (!fs.existsSync(dest)) {
            const s3Obj = await storage
              .getFileContents(img.s3Key as string)
              .catch((error: unknown) => {
                if (isMissingObject(error)) {
                  throw new HttpCodedError(
                    'An image in this draft is no longer available. Upload it again.',
                    404,
                    'image_missing'
                  );
                }
                throw error;
              });
            if (s3Obj.Body != null) {
              fs.writeFileSync(dest, s3Obj.Body as Buffer);
            }
          }
        }
      }

      const deckInfo = {
        deckName: input.deckName,
        mode: input.mode,
        images: input.images.map((img) => ({
          ...img,
          imageName: path.basename(img.imageName),
        })),
      };

      fs.writeFileSync(
        path.join(workspaceDir, 'deck_info.json'),
        JSON.stringify(deckInfo),
        'utf-8'
      );

      const apkgPath = await this.runPythonBridge(workspaceDir);
      return apkgPath;
    } catch (err) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      throw err;
    }
  }

  private runPythonBridge(workspaceDir: string): Promise<string> {
    const python = findPython();
    return new Promise((resolve, reject) => {
      const proc = spawn(python, [IO_SCRIPT_PATH, workspaceDir], {
        cwd: workspaceDir,
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString()));
      proc.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

      proc.on('error', reject);

      proc.on('close', (code) => {
        if (code !== 0) {
          const stderr = stderrChunks.join('');
          return reject(
            new Error(`IO deck builder exited with code ${code}: ${stderr}`)
          );
        }
        const output = stdoutChunks.join('').trim();
        const lastLine = output.split('\n').pop() ?? '';
        if (!lastLine.endsWith('.apkg')) {
          return reject(
            new Error(
              `IO deck builder did not return a valid .apkg path. stdout: ${output || '(empty)'}`
            )
          );
        }
        resolve(lastLine);
      });
    });
  }
}
