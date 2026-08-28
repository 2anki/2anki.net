export type DownloadFailure =
  | { kind: 'image_limit' }
  | { kind: 'failed'; message: string | null };

export function resolveDownloadError(
  status: number,
  body: unknown
): DownloadFailure {
  const record =
    body != null && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  if (status === 403 && record.code === 'image_limit') {
    return { kind: 'image_limit' };
  }
  return {
    kind: 'failed',
    message: typeof record.message === 'string' ? record.message : null,
  };
}
