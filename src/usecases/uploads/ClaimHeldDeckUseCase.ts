import type { IHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import type { UploadedFile } from '../../lib/storage/types';
import { EmptyDeckError } from '../jobs/EmptyDeckError';
import {
  ANONYMOUS_CARD_CAP,
  MonthlyLimitError,
} from '../users/CheckMonthlyCardLimitUseCase';
import { isPreviewHoldKey } from '../../lib/upload/anonymousAiPreview';

export class NoHeldDeckError extends Error {
  constructor() {
    super('No held deck for this visitor');
    this.name = 'NoHeldDeckError';
  }
}

export class HeldDeckExpiredError extends Error {
  constructor() {
    super('Held deck is no longer available');
    this.name = 'HeldDeckExpiredError';
  }
}

export interface HeldFileStore {
  getFileContents(key: string): Promise<{ Body: Buffer | undefined }>;
}

export interface HeldDeckConversion {
  downloadKey: string;
  cardCount: number;
  cardsHeldBack: number;
  deckName: string;
  heldForPlan?: boolean;
}

export interface HeldDeckConversionOptions {
  // Cut the deck to this many cards and save the source as a plan hold, so a
  // pass bought afterwards releases the rest without a re-upload.
  previewCap: number;
}

export interface HeldDeckConverter {
  convertHeldFileForOwner(
    owner: string,
    file: UploadedFile,
    paying: boolean,
    source: null,
    requestId: string | undefined,
    options?: HeldDeckConversionOptions
  ): Promise<HeldDeckConversion>;
}

export type HoldKind = 'signup' | 'plan';

export interface ClaimResult {
  downloadKey: string;
  cardCount: number;
  deckName: string;
  kind: HoldKind;
  // Set only when a sign-up claim was cut to the preview.
  cardsHeldBack?: number;
  heldForPlan?: boolean;
}

export interface ClaimParams {
  anonId: string | null;
  owner: string;
  paying: boolean;
  requestId: string | undefined;
}

// A signed-in free user whose upload was cut at the monthly limit has the
// source file held under this key, so the full deck can be built once they
// pay. Only the owner reaches it: holdKeys derives it from the session, and
// isPlanHoldKey keeps a cookie forged in this shape out of the lookup.
const PLAN_HOLD_PREFIX = 'plan:';

export function planHoldKey(owner: string): string {
  return `${PLAN_HOLD_PREFIX}${owner}`;
}

// The anon_id cookie is client-controlled: a visitor who sets it to
// `plan:<someone>` must never reach another owner's plan hold.
export function isPlanHoldKey(anonId: string): boolean {
  return anonId.startsWith(PLAN_HOLD_PREFIX);
}

function holdKeys(
  anonId: string | null,
  owner: string | null,
  paying: boolean
) {
  const keys: { key: string; kind: HoldKind }[] = [];
  // A client-set anon_id cookie must never be treated as a sign-up hold key
  // when it carries a reserved namespace prefix: `plan:` is a signed-in plan
  // hold, and `preview:` is an anonymous AI-preview source. Either would let a
  // crafted cookie claim or peek a hold that belongs to another flow or user.
  if (anonId != null && !isPlanHoldKey(anonId) && !isPreviewHoldKey(anonId)) {
    keys.push({ key: anonId, kind: 'signup' });
  }
  if (paying && owner != null) {
    keys.push({ key: planHoldKey(owner), kind: 'plan' });
  }
  return keys;
}

function isMissingObjectError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.includes('NoSuchKey');
}

function isDeterministicRefusal(error: unknown): boolean {
  return (
    error instanceof MonthlyLimitError ||
    error instanceof HeldDeckExpiredError ||
    error instanceof EmptyDeckError
  );
}

export class ClaimHeldDeckUseCase {
  constructor(
    private readonly repository: IHeldDeckRepository,
    private readonly store: HeldFileStore,
    private readonly converter: HeldDeckConverter,
    private readonly passFirst: () => Promise<boolean> = async () => false
  ) {}

  // With the pass-first wall on, a free sign-up releases the same 21-card
  // preview an anonymous visitor gets; the full deck takes a plan claim (a
  // pass or Pro). A failed flag read keeps the old up-to-100-card claim.
  private async capsSignupToPreview(
    kind: HoldKind,
    paying: boolean
  ): Promise<boolean> {
    if (kind !== 'signup' || paying) {
      return false;
    }
    try {
      return await this.passFirst();
    } catch (error) {
      console.error('[ClaimHeldDeck] pass-first flag read failed', error);
      return false;
    }
  }

  // A plan hold is only visible once the owner pays: before that there is
  // nothing to claim, and the full deck would be refused at the limit again.
  async peek(
    anonId: string | null,
    owner: string | null = null,
    paying = false
  ): Promise<{ cardCount: number; cardsHeldBack: number } | null> {
    const found = await this.findClaimable(holdKeys(anonId, owner, paying));
    if (found == null) {
      return null;
    }
    const { hold } = found;
    return { cardCount: hold.card_count, cardsHeldBack: hold.cards_held_back };
  }

  async execute(params: ClaimParams): Promise<ClaimResult> {
    const { anonId, owner, paying, requestId } = params;
    const keys = holdKeys(anonId, owner, paying);
    const found = await this.findClaimable(keys);
    if (found == null) {
      for (const { key } of keys) {
        if ((await this.repository.findNewestByAnonId(key)) != null) {
          throw new HeldDeckExpiredError();
        }
      }
      throw new NoHeldDeckError();
    }
    const { hold, kind } = found;
    const capToPreview = await this.capsSignupToPreview(kind, paying);
    const claimed = await this.repository.markClaimed(
      hold.id,
      Number(owner),
      new Date()
    );
    if (!claimed) {
      throw new HeldDeckExpiredError();
    }
    try {
      const file = await this.readHeldFile(hold.storage_key, hold.filename);
      const conversion = capToPreview
        ? await this.converter.convertHeldFileForOwner(
            owner,
            file,
            paying,
            null,
            requestId,
            { previewCap: ANONYMOUS_CARD_CAP }
          )
        : await this.converter.convertHeldFileForOwner(
            owner,
            file,
            paying,
            null,
            requestId
          );
      return {
        downloadKey: conversion.downloadKey,
        cardCount: conversion.cardCount,
        deckName: conversion.deckName,
        kind,
        ...(capToPreview
          ? {
              cardsHeldBack: conversion.cardsHeldBack,
              heldForPlan: conversion.heldForPlan === true,
            }
          : {}),
      };
    } catch (error) {
      // Deterministic refusals consume the hold: a monthly-limit refusal, a
      // missing object and an empty deck would repeat on every visit until the
      // hold expires. Anything else releases the claim so the next visit can
      // try again.
      if (!isDeterministicRefusal(error)) {
        await this.repository.releaseClaim(hold.id, Number(owner));
      }
      throw error;
    }
  }

  private async findClaimable(keys: { key: string; kind: HoldKind }[]) {
    const now = new Date();
    for (const { key, kind } of keys) {
      const hold = await this.repository.findNewestClaimable(key, now);
      if (hold != null) {
        return { hold, kind };
      }
    }
    return null;
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
        throw new HeldDeckExpiredError();
      }
      throw error;
    }
    if (body == null) {
      throw new HeldDeckExpiredError();
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

export default ClaimHeldDeckUseCase;
