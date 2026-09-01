// Catalog of the named resource caps enforced across the server. Each cap is
// re-exported from the module that enforces it so the value stays colocated
// with the code (and any runtime-evidence comment) that reads it; this file is
// the single answer to "what are all the limits and who enforces them".
// Values are not defined here — do not change a cap here; change it at its
// enforcement site, where the reasoning lives.

// Mindmap map-count tiers (free 3, subscriber 25) — enforced in
// CreateMindmapUseCase via resolveMapLimit (count >= limit → MindmapLimitError).
export {
  FREE_MAP_LIMIT,
  SUBSCRIBER_MAP_LIMIT,
} from '../usecases/mindmaps/CreateMindmapUseCase';

// Mindmap node-count tiers (free 50, subscriber 250) — enforced in
// UpdateMindmapUseCase via resolveNodeLimit (nodes.length > limit).
export {
  FREE_NODE_LIMIT,
  SUBSCRIBER_NODE_LIMIT,
} from '../usecases/mindmaps/UpdateMindmapUseCase';

// Mindmap image upload size (5 MB) — enforced in UploadMindmapImageUseCase
// (file.size > limit → MindmapImageTooLargeError); the MindmapRouter multer
// fileSize limit mirrors this value at the request boundary.
export { MINDMAP_IMAGE_MAX_BYTES } from '../usecases/mindmaps/UploadMindmapImageUseCase';

// Free-account monthly card cap (100) and anonymous conversion cap (21) —
// enforced in CheckMonthlyCardLimitUseCase; also read by NotionController,
// UsersControllers, and UploadService. Note: the apkg->CSV export page keeps
// its own CSV_ANONYMOUS_NOTE_LIMIT (also 21) deliberately separate.
export {
  MONTHLY_CARD_LIMIT,
  ANONYMOUS_CARD_CAP,
} from '../usecases/users/CheckMonthlyCardLimitUseCase';

// Free-tier upload size (100 MB) — enforced in getUploadLimits as the multer
// fileSize for non-paying users (paying users get 100x this).
export { FREE_USER_MAX_UPLOAD_SIZE } from './misc/getUploadLimits';

// Free/anonymous PDF page cap (100) — enforced in convertPDFToImages
// (pageCount > limit → PDF_EXCEEDS_MAX_PAGE_LIMIT).
export { PDF_FREE_MAX_PAGES } from '../infrastracture/adapters/fileConversion/convertPDFToImages';

// Claude input-chunk budgets — enforced in ClaudeService.chunkHtmlByDetails.
// CHUNK_SIZE is the default HTML chunk length; past GIANT_INPUT_THRESHOLD the
// chunks drop to GIANT_INPUT_CHUNK_SIZE; CHUNK_MAX_TOKENS caps each chunk's
// generated output. The why-behind-each-value comments live in ClaudeService.
export {
  CHUNK_SIZE,
  GIANT_INPUT_THRESHOLD,
  GIANT_INPUT_CHUNK_SIZE,
  CHUNK_MAX_TOKENS,
} from './claude/ClaudeService';
