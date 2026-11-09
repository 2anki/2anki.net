import { classifyUploadError } from '../../components/errors/helpers/getErrorMessage';
import { isUploadErrorCode } from '../../types/UploadErrorBody';

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
  const serverMessage =
    typeof record.message === 'string' ? record.message : null;
  // A known upload code has translated copy; the server message is English.
  if (isUploadErrorCode(record.code) && record.code !== 'unknown') {
    const friendly = classifyUploadError({
      code: record.code,
      message: serverMessage ?? '',
    });
    return {
      kind: 'failed',
      message: [friendly.title, friendly.detail].filter(Boolean).join(' '),
    };
  }
  return { kind: 'failed', message: serverMessage };
}
