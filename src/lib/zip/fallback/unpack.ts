import { spawn } from 'node:child_process';
import { createWriteStream, promises as fsPromises } from 'node:fs';
import { join } from 'node:path';

import { MAX_EXTRACTED_BYTES } from '../zipLimits';
import { excludeExtractionArtifacts } from './excludeExtractionArtifacts';
import { listFiles } from './listFiles';
import { File } from './types';

export const RECOVERY_TOO_LARGE_MESSAGE =
  'This upload is too large to process. Split it into smaller uploads and try again.';

export interface UnpackLimits {
  tarPath: string;
  maxBytes: number;
  timeoutMs: number;
  checkIntervalMs: number;
}

const DEFAULT_LIMITS: UnpackLimits = {
  tarPath: '/usr/bin/bsdtar',
  maxBytes: MAX_EXTRACTED_BYTES,
  timeoutMs: 120_000,
  checkIntervalMs: 250,
};

async function extractedBytes(
  directory: string,
  archivePath: string
): Promise<number> {
  const entries = await fsPromises
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  let total = 0;
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await extractedBytes(entryPath, archivePath);
    } else if (entry.isFile() && entryPath !== archivePath) {
      // bsdtar can replace an entry between readdir and lstat.
      const stats = await fsPromises.lstat(entryPath).catch(() => null);
      total += stats?.size ?? 0;
    }
  }
  return total;
}

export function unpack(
  filePath: string,
  workspace: string,
  limits: UnpackLimits = DEFAULT_LIMITS
): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const stdoutLogPath = join(workspace, 'tar_stdout.log');
    const stderrLogPath = join(workspace, 'tar_stderr.log');

    const stdoutStream = createWriteStream(stdoutLogPath, { flags: 'a' });
    const stderrStream = createWriteStream(stderrLogPath, { flags: 'a' });

    const decompressProcess = spawn(limits.tarPath, ['xvf', filePath], {
      cwd: workspace,
    });

    decompressProcess.stdout.pipe(stdoutStream);
    decompressProcess.stderr.pipe(stderrStream);

    let settled = false;
    let checking = false;

    const rejectAndClean = () => {
      const fail = () => reject(new Error(RECOVERY_TOO_LARGE_MESSAGE));
      fsPromises
        .rm(workspace, { recursive: true, force: true })
        .then(fail, fail);
    };

    const abort = () => {
      if (settled) return;
      settled = true;
      clearInterval(sizeCheck);
      clearTimeout(deadline);
      decompressProcess.once('close', rejectAndClean);
      decompressProcess.kill('SIGKILL');
    };

    const sizeCheck = setInterval(() => {
      if (checking) return;
      checking = true;
      extractedBytes(workspace, filePath)
        .then((bytes) => {
          if (bytes > limits.maxBytes) abort();
        })
        .finally(() => {
          checking = false;
        });
    }, limits.checkIntervalMs);

    const deadline = setTimeout(abort, limits.timeoutMs);

    decompressProcess.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearInterval(sizeCheck);
      clearTimeout(deadline);
      reject(error);
    });

    decompressProcess.on('close', () => {
      if (settled) return;
      settled = true;
      clearInterval(sizeCheck);
      clearTimeout(deadline);
      // We are not reading the status code because we support partial extraction
      listFiles(workspace)
        .then((files) => {
          const extracted = excludeExtractionArtifacts(files, [
            filePath,
            stdoutLogPath,
            stderrLogPath,
          ]);
          const total = extracted.reduce((sum, f) => sum + (f.size ?? 0), 0);
          if (total > limits.maxBytes) {
            rejectAndClean();
            return;
          }
          resolve(extracted);
        })
        .catch(reject);
    });
  });
}
