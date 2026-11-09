import { stripHtmlTags } from '../../../lib/text/stripHtmlTags';
import {
  readPageRangeDetails,
  readTooLongSetting,
} from './readUploadErrorDetails';
import {
  isUploadErrorCode,
  type UploadErrorBody,
  type UploadErrorCode,
} from '../../../types/UploadErrorBody';
import { isEmptyUploadReading } from '../../../lib/upload/isEmptyUploadReading';
import { readRescueCandidates } from '../../../lib/upload/isRescueCandidate';

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
      if (isEmptyUploadReading(body.reading)) {
        result.reading = body.reading;
      }
      const rescue = readRescueCandidates(body.rescue);
      if (rescue.length > 0) {
        result.rescue = rescue;
      }
      if (typeof body.signed_in === 'boolean') {
        result.signed_in = body.signed_in;
      }
      const pageRange = readPageRangeDetails(body.page_range);
      if (code === 'pdf_page_range' && pageRange != null) {
        result.page_range = pageRange;
      }
      const setting = readTooLongSetting(body.setting);
      if (code === 'setting_too_long' && setting != null) {
        result.setting = setting;
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
