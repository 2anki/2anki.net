import type UserUpload from '../../../../../lib/interfaces/UserUpload';

const CLOCK_SKEW_MS = 60_000;

function baseName(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return stem.toLowerCase();
}

function namesRelated(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function findRecoveredUpload(
  uploads: UserUpload[],
  inputFilename: string,
  submittedAtMs: number
): UserUpload | null {
  const target = baseName(inputFilename);
  if (target.length === 0) return null;

  const match = uploads
    .map((upload) => ({
      upload,
      createdMs: upload.created_at ? Date.parse(upload.created_at) : Number.NaN,
    }))
    .filter(
      (candidate) =>
        Number.isFinite(candidate.createdMs) &&
        candidate.createdMs >= submittedAtMs - CLOCK_SKEW_MS
    )
    .sort((a, b) => b.createdMs - a.createdMs)
    .find((candidate) =>
      namesRelated(baseName(candidate.upload.filename), target)
    );

  return match ? match.upload : null;
}
