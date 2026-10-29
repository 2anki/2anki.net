import type { IHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import type { IAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type { UploadedFile } from '../../lib/storage/types';
import { isPreviewHoldKey } from '../../lib/upload/anonymousAiPreview';
import {
  HeldDeckExpiredError,
  NoHeldDeckError,
  isDeterministicRefusal,
  isPlanHoldKey,
  readHeldFile,
  type HeldFileStore,
} from './ClaimHeldDeckUseCase';
import {
  AI_PREVIEW_CHECKOUT_SURFACE,
  type CheckoutBindingReader,
} from './ResumeAnonymousAiPreviewUseCase';

export interface PassHeldDeckConversion {
  apkg: Buffer;
  cardCount: number;
  deckName: string;
}

export interface HeldDeckPassConverter {
  convertHeldFileForPass(
    anonymousPassId: number,
    file: UploadedFile,
    cardOptions: Record<string, string>,
    requestId: string | undefined
  ): Promise<PassHeldDeckConversion>;
}

export interface ClaimHeldDeckWithPassParams {
  anonymousPassId: number;
  anonId: string;
  cardOptions: Record<string, string>;
  requestId: string | undefined;
}

// A signed-out visitor whose upload was held at the no-account cap buys a pass
// and comes back without an account. The caller only reaches here with a
// valid, paid, active pass (the middleware resolves X-Pass-Token to
// anonymousPassId). The release is bound to that pass's OWN checkout session
// metadata, read from Stripe: the anon id stamped at purchase must equal the
// presenting anon_id cookie, so a pass only ever releases the hold of the
// visitor who bought it. A pass bought from the AI preview belongs to the AI
// resume and is left to it. The hold is claimed atomically before conversion,
// so a reused or concurrent request gets nothing, and released on a transient
// failure so the visitor can retry.
export class ClaimHeldDeckWithPassUseCase {
  constructor(
    private readonly repository: IHeldDeckRepository,
    private readonly store: HeldFileStore,
    private readonly converter: HeldDeckPassConverter,
    private readonly passRepository: Pick<IAnonymousPassRepository, 'findById'>,
    private readonly readBinding: CheckoutBindingReader
  ) {}

  async execute(
    params: ClaimHeldDeckWithPassParams
  ): Promise<PassHeldDeckConversion> {
    const { anonymousPassId, anonId, cardOptions, requestId } = params;
    if (isPlanHoldKey(anonId) || isPreviewHoldKey(anonId)) {
      throw new NoHeldDeckError();
    }
    const now = new Date();
    const hold = await this.repository.findNewestClaimable(anonId, now);
    if (hold == null) {
      if ((await this.repository.findNewestByAnonId(anonId)) != null) {
        throw new HeldDeckExpiredError();
      }
      throw new NoHeldDeckError();
    }
    const pass = await this.passRepository.findById(anonymousPassId);
    if (pass == null) {
      throw new NoHeldDeckError();
    }
    const binding = await this.readBinding(pass.stripe_session_id);
    if (
      binding.anonId == null ||
      binding.anonId !== anonId ||
      binding.surface === AI_PREVIEW_CHECKOUT_SURFACE
    ) {
      throw new NoHeldDeckError();
    }
    if (!(await this.repository.claimForConversion(hold.id, now))) {
      throw new HeldDeckExpiredError();
    }
    try {
      const file = await readHeldFile(
        this.store,
        hold.storage_key,
        hold.filename
      );
      return await this.converter.convertHeldFileForPass(
        anonymousPassId,
        file,
        cardOptions,
        requestId
      );
    } catch (error) {
      if (!isDeterministicRefusal(error)) {
        await this.repository.releaseConversionClaim(hold.id);
      }
      throw error;
    }
  }
}

export default ClaimHeldDeckWithPassUseCase;
