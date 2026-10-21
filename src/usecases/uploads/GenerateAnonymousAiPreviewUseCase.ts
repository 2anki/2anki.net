import type { AiPreviewCard } from '../../lib/claude/aiPreview';
import { isAiPreviewExtractable } from '../../lib/upload/extractPreviewText';

export interface AnonymousAiPreviewInput {
  anonId: string | null;
  ipKey: string;
  filename: string;
  bytes: Buffer;
  requestId?: string;
}

export interface AnonymousAiPreviewDeps {
  isEnabled(): Promise<boolean>;
  allow(anonId: string, ipKey: string): boolean;
  preview(
    filename: string,
    bytes: Buffer,
    requestId?: string
  ): Promise<AiPreviewCard[]>;
  storeSource(anonId: string, filename: string, bytes: Buffer): Promise<void>;
  onShown(anonId: string, cardCount: number): void;
}

// Decides whether a no-account AI upload gets the capped preview, and runs it.
// Returns the sample cards to show, or null to mean "do nothing new" so the
// caller falls back to today's behaviour. The order matters: the flag, the
// visitor id, the file type and the rate limits are all checked before the
// (billable) preview call, so an over-limit or ineligible request never reaches
// the model. The source file is stored only after cards exist, so a held file
// always has a preview behind it; a storage failure degrades the later resume
// but never costs the visitor the preview they are looking at.
export async function generateAnonymousAiPreview(
  input: AnonymousAiPreviewInput,
  deps: AnonymousAiPreviewDeps
): Promise<AiPreviewCard[] | null> {
  if (!(await deps.isEnabled())) {
    return null;
  }
  if (input.anonId == null) {
    return null;
  }
  if (!isAiPreviewExtractable(input.filename)) {
    return null;
  }
  if (!deps.allow(input.anonId, input.ipKey)) {
    return null;
  }
  let cards: AiPreviewCard[];
  try {
    cards = await deps.preview(input.filename, input.bytes, input.requestId);
  } catch (error) {
    console.error('[ai-preview] preview generation failed', {
      requestId: input.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (cards.length === 0) {
    return null;
  }
  try {
    await deps.storeSource(input.anonId, input.filename, input.bytes);
  } catch (error) {
    console.error('[ai-preview] could not store source for resume', {
      requestId: input.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  deps.onShown(input.anonId, cards.length);
  return cards;
}
