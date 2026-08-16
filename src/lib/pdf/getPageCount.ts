import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

const DIAGNOSTIC_LOG_BASENAME_MAX = 80;

async function writeDiagnosticLog(
  filePath: string,
  contents: string
): Promise<void> {
  try {
    await fs.writeFile(filePath, contents);
  } catch (error) {
    console.warn('[pdfinfo] diagnostic log write failed:', error);
  }
}

export function getPageCount(
  pdfPath: string,
  credential?: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const pdfinfoBin =
      process.platform === 'darwin'
        ? '/usr/local/bin/pdfinfo'
        : '/usr/bin/pdfinfo';

    const args = credential != null ? ['-upw', credential, pdfPath] : [pdfPath];

    const pdfinfoProcess = spawn(pdfinfoBin, args);

    let stdout = '';
    let stderr = '';
    let spawnError: Error | null = null;

    pdfinfoProcess.stdout.on('data', (data) => {
      stdout += data;
    });

    pdfinfoProcess.stderr.on('data', (data) => {
      stderr += data;
    });

    pdfinfoProcess.on('error', (err) => {
      spawnError = err;
    });

    pdfinfoProcess.on('close', async (code, signal) => {
      const pdfDir = path.dirname(pdfPath);
      const pdfBaseName = path.basename(pdfPath, path.extname(pdfPath));
      const basename = path.basename(pdfPath);
      const logBase = pdfBaseName.slice(0, DIAGNOSTIC_LOG_BASENAME_MAX);

      await writeDiagnosticLog(
        path.join(pdfDir, `${logBase}_stdout.log`),
        stdout
      );
      await writeDiagnosticLog(
        path.join(pdfDir, `${logBase}_stderr.log`),
        stderr
      );

      if (spawnError != null) {
        reject(new Error(`pdfinfo_spawn_failed: ${spawnError.message}`));
        return;
      }

      if (code !== 0) {
        if (stderr.includes('Encrypted') || stderr.includes('password')) {
          reject(new Error(`pdfinfo_password path=${basename}`));
          return;
        }
        const trimmed = stderr.trim();
        reject(
          new Error(
            `pdfinfo_failed code=${code ?? 'null'} signal=${signal ?? 'none'} path=${basename} stderr=${trimmed.slice(0, 200) || '<empty>'}`
          )
        );
        return;
      }

      const pageCount = parseInt(
        stdout
          .split('\n')
          .find((line) => line.startsWith('Pages:'))
          ?.split(/\s+/)[1] ?? '0'
      );

      if (!pageCount) {
        reject(
          new Error(
            `pdfinfo_failed code=${code ?? 'null'} signal=${signal ?? 'none'} path=${basename} stderr=no_page_count`
          )
        );
        return;
      }

      resolve(pageCount);
    });
  });
}
