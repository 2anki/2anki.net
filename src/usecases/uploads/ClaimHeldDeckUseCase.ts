import type { IHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import type { UploadedFile } from '../../lib/storage/types';

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
  cardsHeldBack: number;
}

export interface ClaimParams {
  anonId: string | null;
  owner: string;
  paying: boolean;
  requestId: string | undefined;
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
    const stored = await this.store.getFileContents(hold.storage_key);
    if (stored.Body == null) {
      throw new HeldDeckExpiredError();
    }
    const file = {
      fieldname: 'file',
      originalname: hold.filename,
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      size: stored.Body.byteLength,
      buffer: stored.Body,
      key: hold.storage_key,
    } as unknown as UploadedFile;
    const conversion = await this.converter.convertHeldFileForOwner(
      owner,
      file,
      paying,
      null,
      requestId
    );
    await this.repository.markClaimed(hold.id, Number(owner), new Date());
    return {
      downloadKey: conversion.downloadKey,
      cardCount: conversion.cardCount,
      cardsHeldBack: conversion.cardsHeldBack,
    };
  }
}

export default ClaimHeldDeckUseCase;
