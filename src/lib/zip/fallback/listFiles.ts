import fs from 'fs';

import { File } from './types';

// Contents stay on disk until something asks for them, so recovering an
// archive never holds all of its entries in memory at once.
function diskBackedFile(filePath: string, size: number): File {
  const file: File = { name: filePath, size };
  Object.defineProperty(file, 'contents', {
    enumerable: true,
    configurable: true,
    get() {
      return new Uint8Array(fs.readFileSync(filePath));
    },
  });
  return file;
}

export async function listFiles(workspace: string) {
  const files: File[] = [];

  async function explorePath(currentPath: string) {
    const dir = await fs.promises.readdir(currentPath);
    for (const fileName of dir) {
      const filePath = `${currentPath}/${fileName}`;
      const stats = await fs.promises.lstat(filePath);

      if (stats.isSymbolicLink()) {
        continue;
      }
      if (stats.isFile()) {
        files.push(diskBackedFile(filePath, stats.size));
      } else if (stats.isDirectory()) {
        await explorePath(filePath); // Recursively explore subdirectories
      }
    }
  }

  await explorePath(workspace);
  return files;
}
