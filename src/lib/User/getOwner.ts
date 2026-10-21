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
