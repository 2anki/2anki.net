import type { AiPreviewCard } from '../../lib/claude/aiPreview';
import { isAiPreviewExtractable } from '../../lib/upload/extractPreviewText';
import { isPreviewHoldKey } from '../../lib/upload/anonymousAiPreview';
import { isPlanHoldKey } from './ClaimHeldDeckUseCase';

export interface ThinDeckAiPreviewInput {
  visitorKey: string;
  ipKey: string;
  filename: string;
  bytes: Buffer;
  requestId?: string;
}

export interface ThinDeckAiPreviewDeps {
  isEnabled(): Promise<boolean>;
  allow(visitorKey: string, ipKey: string): boolean;
  preview(
    filename: string,
    bytes: Buffer,
    requestId?: string
  ): Promise<AiPreviewCard[]>;
  onShown(visitorKey: string, cardCount: number): void;
}

// `disabled`: the flag is off. `unsupported`: a file type the preview cannot
// read text from. `unavailable`: the file was readable but no sample came back
// (rate limit, empty text, or a model error). Only `preview` carries cards.
export type ThinDeckAiPreviewOutcome =
  | { kind: 'preview'; cards: AiPreviewCard[] }
  | { kind: 'unavailable' }
  | { kind: 'unsupported' }
  | { kind: 'disabled' };

// Runs the same bounded sample the no-account preview uses, for a person who
// asked for it by tapping the button. Every check that can refuse runs before
// the billable call, so an over-limit or ineligible request never reaches the
// model. Nothing is stored: the file is read for this one call and dropped.
export async function generateThinDeckAiPreview(
  input: ThinDeckAiPreviewInput,
  deps: ThinDeckAiPreviewDeps
): Promise<ThinDeckAiPreviewOutcome> {
  if (!(await deps.isEnabled())) {
    return { kind: 'disabled' };
  }
  if (!isAiPreviewExtractable(input.filename)) {
    return { kind: 'unsupported' };
  }
  if (isPlanHoldKey(input.visitorKey) || isPreviewHoldKey(input.visitorKey)) {
    return { kind: 'unavailable' };
  }
  if (!deps.allow(input.visitorKey, input.ipKey)) {
    return { kind: 'unavailable' };
  }
  let cards: AiPreviewCard[];
  try {
    cards = await deps.preview(input.filename, input.bytes, input.requestId);
  } catch (error) {
    console.error('[thin-deck-preview] preview generation failed', {
      requestId: input.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: 'unavailable' };
  }
  if (cards.length === 0) {
    return { kind: 'unavailable' };
  }
  deps.onShown(input.visitorKey, cards.length);
  return { kind: 'preview', cards };
}
