import { MAX_OLD_GENERATION_SIZE_MB } from '../conversionMemoryLimits';

// Conversion runs in a Piscina worker whose V8 old-generation heap is capped at
// MAX_OLD_GENERATION_SIZE_MB. The text ceiling below derives from that cap so
// the friendly "too large" error fires BEFORE V8 kills the worker with
// ERR_WORKER_OUT_OF_MEMORY (#3717). Note the decompressed bytes themselves live
// mostly in EXTERNAL (ArrayBuffer) memory outside the old-gen cap — the real
// extraction ceiling is process RSS, which is why extraction is batched below.
const WORKER_OLD_GEN_BYTES = MAX_OLD_GENERATION_SIZE_MB * 1024 * 1024;

// Text we KEEP in memory (decoded HTML/markdown, the OCR html) is stored as
// UTF-16 strings — roughly 2× the counted byte length — so hold this ceiling to
// about half the worker old-gen cap to leave headroom for that overhead, the
// inflated archive map, and other allocations. Binary entries (images, audio,
// misc media) are spilled to disk and bounded instead by the compressed-upload
// cap (`getUploadLimits().fileSize`); they do not count here (#3709/#3711).
export const MAX_IN_MEMORY_BYTES = Math.floor(WORKER_OLD_GEN_BYTES * 0.5);

// Extraction is batched: a census pass reads every entry's declared size from
// the central directory WITHOUT inflating anything, then entries inflate in
// bounded batches that spill to disk and release. Peak resident bytes during
// extraction are therefore one batch (plus the compressed input), never the
// archive's total decompressed size — which is what let a real 643MB paying
// export through where the old whole-archive inflation could not. The total
// decompressed budget moved from a heap bound to a DISK budget: a zip bomb
// (DEFLATE of zeros, ~1000:1; nested archives compound it) still aborts with
// the friendly error at the census, before a single byte inflates (#3717).
export const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024 * 1024;

// One uploaded file's total time in the bsdtar recovery step, across every
// archive inside it: the extraction budget above at about 14 MB/s.
export const MAX_RECOVERY_MS = 300_000;
