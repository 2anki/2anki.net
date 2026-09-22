import { spawn } from 'child_process';
import os from 'os';

export function convertPage(
  pdfPath: string,
  pageNumber: number,
  totalPageCount: number
): Promise<string> {
  const outputFileNameBase = `${pdfPath}-page${pageNumber}`;

  const determinePaddingLength = (pageCount: number): number => {
    if (pageCount >= 1000) return 4;
    if (pageCount >= 100) return 3;
    if (pageCount >= 10) return 2;
    return 1;
  };

  const paddedPageNumber = String(pageNumber).padStart(
    determinePaddingLength(totalPageCount),
    '0'
  );

  const pdftoppmPath =
    os.platform() === 'darwin'
      ? '/usr/local/bin/pdftoppm'
      : '/usr/bin/pdftoppm';

  return new Promise((resolve, reject) => {
    const process = spawn(pdftoppmPath, [
      '-png',
      '-f',
      pageNumber.toString(),
      '-l',
      pageNumber.toString(),
      pdfPath,
      outputFileNameBase,
    ]);

    process.on('error', (error) => {
      reject(
        new Error(
          `Failed to convert page ${pageNumber} to PNG: ${error.message}`
        )
      );
    });

    process.on('close', (code, signal) => {
      if (code !== 0) {
        return reject(
          new Error(
            `pdftoppm process exited with code=${code ?? 'null'} signal=${signal ?? 'none'}`
          )
        );
      }
      resolve(`${outputFileNameBase}-${paddedPageNumber}.png`);
    });
  });
}
