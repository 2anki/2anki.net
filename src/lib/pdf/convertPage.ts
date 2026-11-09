import { spawn } from 'child_process';
import os from 'os';

// pdfinfo and pdftoppm keep only the first 32 bytes of a password, while
// pdf.js and AES-256 PDFs accept longer ones, so a longer password that
// poppler refuses may well be right.
const POPPLER_PASSWORD_MAX_BYTES = 32;

export function popplerTruncatesPassword(credential?: string): boolean {
  return (
    credential != null &&
    Buffer.byteLength(credential, 'utf8') > POPPLER_PASSWORD_MAX_BYTES
  );
}

// The person may know either password: pdf.js accepts both on the text path,
// and poppler tries the owner password first, then the user password.
export function passwordArgs(credential?: string): string[] {
  return credential == null ? [] : ['-opw', credential, '-upw', credential];
}

export function convertPage(
  pdfPath: string,
  pageNumber: number,
  totalPageCount: number,
  credential?: string
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
      ...passwordArgs(credential),
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
