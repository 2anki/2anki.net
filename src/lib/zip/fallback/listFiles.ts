import fs from 'fs';

import { File } from './types';
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
        const buffer = await fs.promises.readFile(filePath);
        files.push({
          name: filePath,
          contents: new Uint8Array(buffer),
        });
      } else if (stats.isDirectory()) {
        await explorePath(filePath); // Recursively explore subdirectories
      }
    }
  }

  await explorePath(workspace);
  return files;
}
