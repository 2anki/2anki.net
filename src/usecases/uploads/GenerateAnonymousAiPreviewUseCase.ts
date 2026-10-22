import type { AiPreviewCard } from '../../lib/claude/aiPreview';
import { isAiPreviewExtractable } from '../../lib/upload/extractPreviewText';
import { isPreviewHoldKey } from '../../lib/upload/anonymousAiPreview';
import { isPlanHoldKey } from './ClaimHeldDeckUseCase';

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

// `preview` — show the sample cards. `unavailable` — AI was asked for and the
// file could be read, but no preview came back (daily limit, empty, or error),
// so the caller ships the free deck AND tells the visitor the AI preview wasn't
// available. `skip` — nothing was attempted (flag off, no visitor id, reserved
// cookie, or an unreadable file type), so the caller just runs today's path
// with no notice.
export type AnonymousAiPreviewOutcome =
  | { kind: 'preview'; cards: AiPreviewCard[] }
  | { kind: 'unavailable' }
  | { kind: 'skip' };

// Decides whether a no-account AI upload gets the capped preview, and runs it.
// The order matters: the flag, the visitor id, the cookie namespace, the file
// type and the rate limits are all checked before the (billable) preview call,
// so an over-limit or ineligible request never reaches the model. The source
// file is stored only after cards exist, so a held file always has a preview
// behind it; a storage failure degrades the later resume but never costs the
// visitor the preview they are looking at.
export async function generateAnonymousAiPreview(
  input: AnonymousAiPreviewInput,
  deps: AnonymousAiPreviewDeps
): Promise<AnonymousAiPreviewOutcome> {
  if (!(await deps.isEnabled())) {
    return { kind: 'skip' };
  }
  if (input.anonId == null) {
    return { kind: 'skip' };
  }
  // A reserved-namespace cookie (`plan:` or `preview:`) must never become a
  // preview hold key — storing under it would plant into another flow's or
  // visitor's namespace. Fall through to today's behaviour instead.
  if (isPlanHoldKey(input.anonId) || isPreviewHoldKey(input.anonId)) {
    return { kind: 'skip' };
  }
  if (!isAiPreviewExtractable(input.filename)) {
    return { kind: 'skip' };
  }
  if (!deps.allow(input.anonId, input.ipKey)) {
    return { kind: 'unavailable' };
  }
  let cards: AiPreviewCard[];
  try {
    cards = await deps.preview(input.filename, input.bytes, input.requestId);
  } catch (error) {
    console.error('[ai-preview] preview generation failed', {
      requestId: input.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: 'unavailable' };
  }
  if (cards.length === 0) {
    return { kind: 'unavailable' };
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
  return { kind: 'preview', cards };
}
