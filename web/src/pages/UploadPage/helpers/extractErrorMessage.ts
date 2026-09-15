import { stripHtmlTags } from '../../../lib/text/stripHtmlTags';
import type {
  UploadErrorBody,
  UploadErrorCode,
} from '../../../types/UploadErrorBody';

const REJECTED_FALLBACK =
  'The server rejected the upload. Try again or email support@2anki.net.';

function isValidCode(value: unknown): value is UploadErrorCode {
  return (
    value === 'unsupported_format' ||
    value === 'too_large' ||
    value === 'invalid_markup' ||
    value === 'malformed_notion' ||
    value === 'corrupted_apkg' ||
    value === 'password_protected_pdf' ||
    value === 'empty_export' ||
    value === 'image_only_no_text' ||
    value === 'ai_credits_exhausted' ||
    value === 'unknown'
  );
}

export async function extractErrorMessage(
  response: Response
): Promise<UploadErrorBody> {
  try {
    const body = await response.clone().json();
    if (typeof body?.message === 'string' && body.message.trim().length > 0) {
      const code: UploadErrorCode = isValidCode(body.code)
        ? body.code
        : 'unknown';
      return { code, message: body.message };
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
