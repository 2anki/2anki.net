export type UploadErrorCode =
  | 'unsupported_format'
  | 'too_large'
  | 'invalid_markup'
  | 'malformed_notion'
  | 'corrupted_apkg'
  | 'password_protected_pdf'
  | 'pdf_processing_failed'
  | 'docx_processing_failed'
  | 'claude_parse_failed'
  | 'empty_export'
  | 'image_only_no_text'
  | 'markdown_likely_lossy'
  | 'parser_crash'
  | 'worker_timeout'
  | 'notion_rate_limit'
  | 'notion_object_not_found'
  | 'apkg_too_large_for_anki'
  | 'zip_invalid'
  | 'ai_credits_exhausted'
  | 'unknown';

export interface UploadErrorBody {
  code: UploadErrorCode;
  message: string;
}
