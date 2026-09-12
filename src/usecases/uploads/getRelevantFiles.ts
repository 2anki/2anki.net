import { File } from '../../lib/zip/zip';

// Root-level siblings only count as images by extension. An extensionless
// root entry is never an image; treating it as one is how a renamed .apkg
// turned every numbered media entry into a "relevant" file (#4409).
const ROOT_IMAGE_RE = /\.(png|jpe?g|gif|bmp|svg|webp|avif)$/i;

export function getRelevantFiles(fileName: string, allFiles: File[]): File[] {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const baseNameWithoutNotionId = baseName.replace(/ [0-9a-f]{32}$/, '');
  const isRootFile = !fileName.includes('/');

  return allFiles.filter(
    (f) =>
      f.name === fileName ||
      f.name.startsWith(baseName + '/') ||
      f.name.startsWith(baseNameWithoutNotionId + '/') ||
      (isRootFile && !f.name.includes('/') && ROOT_IMAGE_RE.test(f.name))
  );
}
