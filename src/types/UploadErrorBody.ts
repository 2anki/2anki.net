export type UploadErrorCode =
  | 'unsupported_format'
  | 'too_large'
  | 'too_many_files'
  | 'invalid_markup'
  | 'malformed_notion'
  | 'corrupted_apkg'
  | 'password_protected_pdf'
  | 'pdf_processing_failed'
  | 'docx_processing_failed'
  | 'claude_parse_failed'
  | 'empty_export'
  | 'markdown_likely_lossy'
  | 'parser_crash'
  | 'worker_timeout'
  | 'notion_rate_limit'
  | 'notion_object_not_found'
  | 'notion_unauthorized'
  | 'apkg_too_large_for_anki'
  | 'zip_invalid'
  | 'unknown';

export interface UploadErrorBody {
  code: UploadErrorCode;
  message: string;
}
