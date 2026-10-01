import type { UploadErrorCode } from '@server/types/UploadErrorBody';

export type {
  UploadErrorBody,
  UploadErrorCode,
} from '@server/types/UploadErrorBody';

export const UPLOAD_ERROR_CODES = [
  'unsupported_format',
  'too_large',
  'too_many_files',
  'invalid_markup',
  'malformed_notion',
  'corrupted_apkg',
  'password_protected_pdf',
  'pdf_processing_failed',
  'docx_processing_failed',
  'claude_parse_failed',
  'empty_export',
  'image_only_no_text',
  'markdown_likely_lossy',
  'parser_crash',
  'worker_timeout',
  'notion_rate_limit',
  'notion_object_not_found',
  'notion_unauthorized',
  'apkg_too_large_for_anki',
  'zip_invalid',
  'ai_credits_exhausted',
  'unknown',
] as const satisfies readonly UploadErrorCode[];

export function isUploadErrorCode(value: unknown): value is UploadErrorCode {
  return (
    typeof value === 'string' &&
    (UPLOAD_ERROR_CODES as readonly string[]).includes(value)
  );
}
