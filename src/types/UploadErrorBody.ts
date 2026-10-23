export type UploadErrorCode =
  | 'unsupported_format'
  | 'too_large'
  | 'too_many_files'
  | 'invalid_markup'
  | 'malformed_notion'
  | 'corrupted_apkg'
  | 'password_protected_pdf'
  | 'pdf_processing_failed'
  | 'pdf_page_range'
  | 'docx_processing_failed'
  | 'claude_parse_failed'
  | 'empty_export'
  | 'image_only_no_text'
  | 'markdown_likely_lossy'
  | 'parser_crash'
  | 'worker_timeout'
  | 'notion_rate_limit'
  | 'notion_object_not_found'
  | 'notion_unauthorized'
  | 'notion_unavailable'
  | 'apkg_too_large_for_anki'
  | 'zip_invalid'
  | 'ai_credits_exhausted'
  | 'unknown';

import type { EmptyDeckReason } from '../usecases/jobs/EmptyDeckError';
import type { EmptyUploadReading } from './EmptyUploadReading';
import type { RescueCandidate } from './RescueCandidate';

export interface UploadErrorBody {
  code: UploadErrorCode;
  message: string;
  empty_reason?: EmptyDeckReason;
  reading?: EmptyUploadReading | null;
  rescue?: RescueCandidate[];
}
