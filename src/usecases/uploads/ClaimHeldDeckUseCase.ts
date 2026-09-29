import type { IHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import type { UploadedFile } from '../../lib/storage/types';
import { MonthlyLimitError } from '../users/CheckMonthlyCardLimitUseCase';

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
  downloadKey: string | null;
  cardCount: number;
  cardsHeldBack: number;
  deckName: string;
}

export interface HeldDeckConverter {
  convertHeldFileForOwner(
    owner: string,
    file: UploadedFile,
    paying: boolean,
    source: null,
    requestId: string | undefined
  ): Promise<HeldDeckConversion>;
}

export interface ClaimResult {
  downloadKey: string | null;
  cardCount: number;
  deckName: string;
}

export interface ClaimParams {
  anonId: string | null;
  owner: string;
  paying: boolean;
  requestId: string | undefined;
}

function isMissingObjectError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.includes('NoSuchKey');
}

export class ClaimHeldDeckUseCase {
  constructor(
    private readonly repository: IHeldDeckRepository,
    private readonly store: HeldFileStore,
    private readonly converter: HeldDeckConverter
  ) {}

  async peek(
    anonId: string | null
  ): Promise<{ cardCount: number; cardsHeldBack: number } | null> {
    if (anonId == null) {
      return null;
    }
    const hold = await this.repository.findNewestClaimable(anonId, new Date());
    if (hold == null) {
      return null;
    }
    return { cardCount: hold.card_count, cardsHeldBack: hold.cards_held_back };
  }

  async execute(params: ClaimParams): Promise<ClaimResult> {
    const { anonId, owner, paying, requestId } = params;
    if (anonId == null) {
      throw new NoHeldDeckError();
    }
    const hold = await this.repository.findNewestClaimable(anonId, new Date());
    if (hold == null) {
      const latest = await this.repository.findNewestByAnonId(anonId);
      if (latest == null) {
        throw new NoHeldDeckError();
      }
      throw new HeldDeckExpiredError();
    }
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
      const conversion = await this.converter.convertHeldFileForOwner(
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
      };
    } catch (error) {
      // A monthly-limit refusal consumes the hold: the account cannot take the
      // deck this month and the hold expires within a day anyway, so retrying
      // on every visit would only repeat the refusal. Anything else releases
      // the claim so the next visit can try again.
      if (!(error instanceof MonthlyLimitError)) {
        await this.repository.releaseClaim(hold.id);
      }
      throw error;
    }
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
