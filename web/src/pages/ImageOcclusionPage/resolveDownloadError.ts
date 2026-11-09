import { classifyUploadError } from '../../components/errors/helpers/getErrorMessage';
import type { UploadErrorCode } from '../../types/UploadErrorBody';

export type DownloadFailure =
  | { kind: 'image_limit' }
  // complete: the copy already says what to do, so the page shows it without
  // its own "try again" wrapper.
  | { kind: 'failed'; message: string | null; complete: boolean };

const SELF_CONTAINED_CODES: ReadonlySet<string> = new Set<UploadErrorCode>([
  'deck_builder_crash',
  'claude_refusal',
]);

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
  if (
    typeof record.code === 'string' &&
    SELF_CONTAINED_CODES.has(record.code)
  ) {
    const friendly = classifyUploadError({
      code: record.code as UploadErrorCode,
      message: serverMessage ?? '',
    });
    return {
      kind: 'failed',
      message: [friendly.title, friendly.detail].filter(Boolean).join(' '),
      complete: true,
    };
  }
  return { kind: 'failed', message: serverMessage, complete: false };
}
