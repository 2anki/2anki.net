import Workspace from '../../../lib/parser/WorkSpace';
import path from 'path';
import { pathToFileURL } from 'node:url';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { getRandomUUID } from '../../../shared/helpers/getRandomUUID';

export function convertPPTToPDF(
  name: string,
  contents: Buffer | Uint8Array | string,
  workspace: Workspace
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const sofficeBin =
      process.platform === 'darwin'
        ? '/Applications/LibreOffice.app/Contents/MacOS/soffice'
        : '/usr/bin/soffice';

    const normalizedName = path.basename(name);
    const tempFile = path.join(workspace.location, normalizedName);
    // Each run gets its own LibreOffice profile: concurrent conversions
    // sharing the default profile collide on its lock and abort (exit 251).
    const profileDir = path.join(
      workspace.location,
      `soffice-profile-${getRandomUUID()}`
    );

    fs.writeFile(tempFile, Buffer.from(contents as Buffer))
      .then(() => {
        const pdfFile = path.join(
          workspace.location,
          path.basename(normalizedName, path.extname(normalizedName)) + '.pdf'
        );

        const sofficeProcess = spawn(
          sofficeBin,
          [
            `-env:UserInstallation=${pathToFileURL(profileDir)}`,
            '--headless',
            '--norestore',
            '--convert-to',
            'pdf',
            '--outdir',
            workspace.location,
            tempFile,
          ],
          {
            cwd: workspace.location,
          }
        );

        let stdout = '';
        let stderr = '';

        sofficeProcess.stdout.on('data', (data) => {
          stdout += data;
        });

        sofficeProcess.stderr.on('data', (data) => {
          stderr += data;
        });

        sofficeProcess.on('close', async (code) => {
          try {
            await fs.writeFile(
              path.join(workspace.location, 'stdout.log'),
              stdout
            );
            await fs.writeFile(
              path.join(workspace.location, 'stderr.log'),
              stderr
            );
            if (code !== 0) {
              const trimmedStderr = stderr.trim();
              const detail = trimmedStderr || stdout.trim() || '(no output)';
              await fs.writeFile(
                path.join(workspace.location, 'error.log'),
                `Conversion failed with code ${code}`
              );
              console.error(
                `PPT to PDF conversion failed with exit code ${code}:`,
                detail
              );
              reject(
                new Error(`Conversion failed with code ${code}: ${detail}`)
              );
              return;
            }
            resolve(await fs.readFile(pdfFile));
          } catch (err) {
            const detail = stderr.trim() || stdout.trim() || '(no output)';
            console.error(
              'PPT to PDF conversion produced no PDF output:',
              detail,
              err
            );
            reject(new Error(`Conversion produced no PDF output: ${detail}`));
          }
        });
      })
      .catch((err) => reject(new Error(err.message || 'File write failed')));
  });
}
