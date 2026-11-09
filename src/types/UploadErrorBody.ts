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
  | 'setting_too_long'
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
  | 'zip_damaged'
  | 'zip_incomplete'
  | 'zip_too_large'
  | 'ai_credits_exhausted'
  | 'owner_changed'
  | 'deck_builder_crash'
  | 'claude_refusal'
  | 'unknown';

import type { EmptyDeckReason } from '../usecases/jobs/EmptyDeckError';
import type { EmptyUploadReading } from './EmptyUploadReading';
import type { RescueCandidate } from './RescueCandidate';
import type { PdfPageRangeDetails } from '../lib/pdf/pdfPageRange';

export interface UploadErrorBody {
  code: UploadErrorCode;
  message: string;
  empty_reason?: EmptyDeckReason;
  reading?: EmptyUploadReading | null;
  rescue?: RescueCandidate[];
  // On owner_changed: whether the session that sent the refused request is
  // signed in, so the page can say what changed before it reads the account.
  signed_in?: boolean;
  // On pdf_page_range: what was wrong and the values the sentence names.
  page_range?: PdfPageRangeDetails;
  // On setting_too_long: which saved setting, when it has its own place in
  // Settings.
  setting?: TooLongSetting;
}

export type TooLongSetting = 'user_instructions' | 'deck_name';
