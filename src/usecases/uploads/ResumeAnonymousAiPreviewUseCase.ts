import type { IHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import type { IAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type { UploadedFile } from '../../lib/storage/types';
import { previewHoldKey } from '../../lib/upload/anonymousAiPreview';
import { AiCreditsExhaustedError } from '../../lib/claude/aiSpendGuard';

export class NoAiPreviewHoldError extends Error {
  constructor() {
    super('No AI preview is waiting for this visitor');
    this.name = 'NoAiPreviewHoldError';
  }
}

export class AiPreviewHoldExpiredError extends Error {
  constructor() {
    super('The held file for this AI preview is no longer available');
    this.name = 'AiPreviewHoldExpiredError';
  }
}

export interface HeldFileStore {
  getFileContents(key: string): Promise<{ Body: Buffer | undefined }>;
  delete(key: string): Promise<boolean>;
}

export interface AiPreviewConversion {
  apkg: Buffer;
  cardCount: number;
  deckName: string;
}

export interface AiPreviewPassConverter {
  convertStoredFileWithAiForPass(
    anonymousPassId: number,
    file: UploadedFile,
    requestId: string | undefined
  ): Promise<AiPreviewConversion>;
}

export interface ResumeAiPreviewParams {
  anonymousPassId: number;
  anonId: string;
  requestId: string | undefined;
}

// The ai-preview binding carried in the pass's own checkout session metadata:
// the anon id the buyer uploaded under and the surface the pass was bought
// from. Both are server-trusted (read from Stripe), never client input.
export interface CheckoutPreviewBinding {
  anonId: string | null;
  surface: string | null;
}

export interface PassCreditCheck {
  isExhausted(anonymousPassId: number): Promise<boolean>;
}

export type CheckoutBindingReader = (
  stripeSessionId: string
) => Promise<CheckoutPreviewBinding>;

export const AI_PREVIEW_CHECKOUT_SURFACE = 'ai-preview';

function isMissingObjectError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.includes('NoSuchKey');
}

// Runs the full AI conversion of the file the visitor uploaded before buying,
// now that they hold a Day Pass. The caller only reaches here with a valid,
// active pass (the middleware resolves the pass token to anonymousPassId), so a
// visitor with no pass or an expired one never resumes with AI.
//
// The resume reads, from the pass's OWN checkout session metadata (server-
// trusted), the anon id the buyer uploaded under and that the pass was bought
// from the ai-preview surface. It requires the presenting anon_id cookie to
// equal that buyer anon id and the surface to match. This proves the same
// visitor who bought this pass, from the preview flow, is the one resuming —
// no more than that; it is not a claim over who else may know an anon_id. The
// hold is claimed atomically before conversion so two concurrent resumes never
// both bill the pass, released on failure so the visitor can retry, and
// consumed on success so the pass is never billed twice for the same file.
// The conversion is metered against the pass by the credit guard, which fails
// closed.
export class ResumeAnonymousAiPreviewUseCase {
  constructor(
    private readonly repository: IHeldDeckRepository,
    private readonly store: HeldFileStore,
    private readonly converter: AiPreviewPassConverter,
    private readonly passRepository: Pick<IAnonymousPassRepository, 'findById'>,
    private readonly readBinding: CheckoutBindingReader,
    private readonly passCredits: PassCreditCheck
  ) {}

  async execute(params: ResumeAiPreviewParams): Promise<AiPreviewConversion> {
    const { anonymousPassId, anonId, requestId } = params;
    const pass = await this.passRepository.findById(anonymousPassId);
    if (pass == null) {
      throw new NoAiPreviewHoldError();
    }
    const binding = await this.readBinding(pass.stripe_session_id);
    if (
      binding.anonId == null ||
      binding.anonId !== anonId ||
      binding.surface !== AI_PREVIEW_CHECKOUT_SURFACE
    ) {
      throw new NoAiPreviewHoldError();
    }
    const hold = await this.repository.findNewestClaimable(
      previewHoldKey(binding.anonId),
      new Date()
    );
    if (hold == null) {
      throw new NoAiPreviewHoldError();
    }
    // A spent pass is refused before any work, so the hold stays untouched and
    // a file the parser cannot read either still answers with the credits stop.
    if (await this.passCredits.isExhausted(anonymousPassId)) {
      console.info('[ai-preview] resume refused: pass AI credits spent', {
        requestId,
        anonymousPassId,
        stage: 'before-conversion',
      });
      throw new AiCreditsExhaustedError();
    }
    // Claim the hold atomically before converting: a second concurrent
    // resume loses the claim and gets nothing, so the pass is billed once.
    if (!(await this.repository.claimForConversion(hold.id, new Date()))) {
      throw new NoAiPreviewHoldError();
    }
    let conversion: AiPreviewConversion;
    try {
      const file = await this.readHeldFile(hold.storage_key, hold.filename);
      conversion = await this.converter.convertStoredFileWithAiForPass(
        anonymousPassId,
        file,
        requestId
      );
    } catch (error) {
      // Release the claim so the visitor can retry; the file and pass are both
      // still intact.
      await this.repository.releaseConversionClaim(hold.id);
      throw error;
    }
    // Remove the row first so a retry cannot re-bill the pass, then the object.
    // A failed object delete only leaves an orphan under the reserved held/
    // prefix (logged); the hold's own TTL sweep collects it either way.
    await this.repository.deleteByIds([hold.id]);
    if (!(await this.store.delete(hold.storage_key))) {
      console.warn('[ai-preview] resumed preview object left in storage', {
        requestId,
      });
    }
    return conversion;
  }

  private async readHeldFile(
    storageKey: string,
    filename: string
  ): Promise<UploadedFile> {
    let body: Buffer | undefined;
    try {
      body = (await this.store.getFileContents(storageKey)).Body;
    } catch (error) {
      if (isMissingObjectError(error)) {
        throw new AiPreviewHoldExpiredError();
      }
      throw error;
    }
    if (body == null) {
      throw new AiPreviewHoldExpiredError();
    }
    return {
      fieldname: 'file',
      originalname: filename,
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      size: body.byteLength,
      buffer: body,
      key: storageKey,
    } as unknown as UploadedFile;
  }
}

export default ResumeAnonymousAiPreviewUseCase;
