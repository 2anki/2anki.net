import express from 'express';

export const getOwner = (response?: express.Response) =>
  response?.locals?.owner;

export function getOwnerId(response?: express.Response): number | null {
  const raw = getOwner(response);
  if (raw == null || raw === '') {
    return null;
  }
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export function getAnonymousPassId(response?: express.Response): number | null {
  const raw = response?.locals?.anonymousPassId;
  if (raw == null) {
    return null;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

const MINTED_ANON_ID_LOCAL = 'mintedAnonId';

export function setMintedAnonId(response: express.Response, id: string): void {
  response.locals[MINTED_ANON_ID_LOCAL] = id;
}

export function getMintedAnonId(response?: express.Response): string | null {
  const minted = response?.locals?.[MINTED_ANON_ID_LOCAL];
  return typeof minted === 'string' && minted.length > 0 ? minted : null;
}
