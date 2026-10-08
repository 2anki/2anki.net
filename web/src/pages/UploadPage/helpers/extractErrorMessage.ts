import { stripHtmlTags } from '../../../lib/text/stripHtmlTags';
import {
  isUploadErrorCode,
  type UploadErrorBody,
  type UploadErrorCode,
} from '../../../types/UploadErrorBody';

const REJECTED_FALLBACK =
  'The server rejected the upload. Try again or email support@2anki.net.';

const isValidCode = isUploadErrorCode;

export async function extractErrorMessage(
  response: Response
): Promise<UploadErrorBody> {
  try {
    const body = await response.clone().json();
    if (typeof body?.message === 'string' && body.message.trim().length > 0) {
      const code: UploadErrorCode = isValidCode(body.code)
        ? body.code
        : 'unknown';
      const result: UploadErrorBody = { code, message: body.message };
      if (typeof body.empty_reason === 'string') {
        result.empty_reason = body.empty_reason;
      }
      return result;
    }
  } catch {
    const text = await response.text().catch(() => '');
    const stripped = stripHtmlTags(text);
    if (stripped.length > 0 && stripped.length < 500) {
      return { code: 'unknown', message: stripped };
    }
  }
  return { code: 'unknown', message: REJECTED_FALLBACK };
}
