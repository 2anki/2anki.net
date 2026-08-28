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
            const s3Obj = await storage.getFileContents(img.s3Key as string);
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
