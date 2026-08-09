import { File } from './types';

// listFiles sweeps the whole extraction workspace, which also holds the
// uploaded archive's own temp copy (extensionless, so it passes
// isZipContentFileSupported's no-extension rule and reaches conversion as
// garbage — the prod #4028 signature) and bsdtar's log files. Only what the
// archive actually contained may flow onward.
export function excludeExtractionArtifacts(
  files: File[],
  artifactPaths: string[]
): File[] {
  const artifacts = new Set(artifactPaths);
  return files.filter((file) => !artifacts.has(file.name));
}
