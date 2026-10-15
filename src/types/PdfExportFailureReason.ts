// The closed set of reasons `POST /api/apkg/pdf` records on `pdf_export_failed`.
// The ops breakdown filters to this list in SQL because `/api/events/track`
// is public and accepts any known event name with free-form props.
export const PDF_EXPORT_FAILURE_REASONS = [
  'no_file',
  'not_apkg',
  'invalid_options',
  'apkg_too_large',
  'card_limit',
  'render_timeout',
  'render_crashed',
  'invalid_apkg',
  'unexpected',
] as const;

export type PdfExportFailureReason =
  (typeof PDF_EXPORT_FAILURE_REASONS)[number];
