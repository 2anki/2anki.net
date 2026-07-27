// Must stay in step with ALLOWED_MIMES in src/controllers/ChatController.ts.
// The server has accepted zip, docx, md, and txt since chat attachments
// shipped — its rejection message names them — but the picker only offered PDF
// and images, so the four types whose text the server persists for follow-up
// turns could never be attached from any client 2anki ships.
// attachmentTypes.parity.test.ts fails when the two lists drift.
const ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
];

export const ALLOWED_ATTACHMENT_TYPES = new Set(ATTACHMENT_MIME_TYPES);

// Extensions ride along because a browser reports an empty type for .md and
// .txt often enough that a MIME-only accept list hides them in the file picker.
export const ATTACHMENT_ACCEPT = [
  ...ATTACHMENT_MIME_TYPES,
  '.zip',
  '.docx',
  '.md',
  '.txt',
].join(',');
