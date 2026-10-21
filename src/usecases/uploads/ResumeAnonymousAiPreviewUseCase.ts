import type { IHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import type { IAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type { UploadedFile } from '../../lib/storage/types';
import { previewHoldKey } from '../../lib/upload/anonymousAiPreview';

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

// Reads the anon id the pass was bought under, straight from its own checkout
// session (server-trusted), given the pass's stripe session id.
export type BuyerAnonIdReader = (
  stripeSessionId: string
) => Promise<string | null>;

function isMissingObjectError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.includes('NoSuchKey');
}

// Runs the full AI conversion of the file the visitor uploaded before buying,
// now that they hold a Day Pass. The caller only reaches here with a valid,
// active pass (the middleware resolves the pass token to anonymousPassId), so a
// visitor with no pass or an expired one never resumes with AI.
//
// The resume is bound to the file the pass was bought for: the buyer's anon id
// comes from the pass's OWN checkout session metadata (server-trusted), not the
// client's anon_id cookie, and the presenting cookie must match it. A pass can
// therefore never convert another visitor's held file even if the attacker
// knows that visitor's anon_id — the hold is looked up under the pass's buyer,
// not under whatever cookie is presented. The conversion is metered against the
// pass by the credit guard, which fails closed; the hold is consumed on success
// so the pass is never billed twice for the same file.
export class ResumeAnonymousAiPreviewUseCase {
  constructor(
    private readonly repository: IHeldDeckRepository,
    private readonly store: HeldFileStore,
    private readonly converter: AiPreviewPassConverter,
    private readonly passRepository: Pick<IAnonymousPassRepository, 'findById'>,
    private readonly resolveBuyerAnonId: BuyerAnonIdReader
  ) {}

  async execute(params: ResumeAiPreviewParams): Promise<AiPreviewConversion> {
    const { anonymousPassId, anonId, requestId } = params;
    const pass = await this.passRepository.findById(anonymousPassId);
    if (pass == null) {
      throw new NoAiPreviewHoldError();
    }
    const buyerAnonId = await this.resolveBuyerAnonId(pass.stripe_session_id);
    if (buyerAnonId == null || buyerAnonId !== anonId) {
      throw new NoAiPreviewHoldError();
    }
    const hold = await this.repository.findNewestClaimable(
      previewHoldKey(buyerAnonId),
      new Date()
    );
    if (hold == null) {
      throw new NoAiPreviewHoldError();
    }
    const file = await this.readHeldFile(hold.storage_key, hold.filename);
    const conversion = await this.converter.convertStoredFileWithAiForPass(
      anonymousPassId,
      file,
      requestId
    );
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
