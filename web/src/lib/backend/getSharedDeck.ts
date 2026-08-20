import { pathOf } from './api';
import { ApkgPreviewBatch, ApkgPreviewMeta } from './getApkgPreview';

async function shareApiError(
  method: string,
  url: string,
  response: Response
): Promise<Error> {
  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
  };
  return new Error(
    data.message ??
      `HTTP error! ${method} ${pathOf(url)} status: ${response.status}, message: ${response.statusText}`
  );
}

async function fetchShareApi<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw await shareApiError('GET', url, response);
  }
  return response.json() as Promise<T>;
}

export async function getSharedDeckMeta(
  token: string
): Promise<ApkgPreviewMeta> {
  return fetchShareApi(`/api/shares/${encodeURIComponent(token)}/meta`);
}

export async function getSharedDeckBatch(
  token: string,
  cursor: number | null,
  options: { pageSize?: number; deckId?: number | null } = {}
): Promise<ApkgPreviewBatch> {
  const { pageSize = 20, deckId = null } = options;
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', String(cursor));
  params.set('page_size', String(pageSize));
  if (deckId != null) params.set('deck_id', String(deckId));
  return fetchShareApi(
    `/api/shares/${encodeURIComponent(token)}/cards?${params.toString()}`
  );
}

export interface CreateShareResponse {
  token: string;
  url: string;
}

export async function createDeckShare(
  uploadKey: string
): Promise<CreateShareResponse> {
  const response = await fetch('/api/shares', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_key: uploadKey }),
  });
  if (!response.ok) {
    throw await shareApiError('POST', '/api/shares', response);
  }
  return response.json() as Promise<CreateShareResponse>;
}

export async function revokeDeckShare(token: string): Promise<void> {
  const response = await fetch(`/api/shares/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok && response.status !== 404) {
    throw new Error('Failed to stop sharing.');
  }
}

export interface ActiveShare {
  token: string;
  upload_key: string;
  url: string;
  created_at: string;
  view_count: number;
}

export async function getActiveSharesForUploadKey(
  uploadKey: string
): Promise<ActiveShare | null> {
  const response = await fetch('/api/shares', { credentials: 'include' });
  if (!response.ok) return null;
  const shares = (await response.json()) as ActiveShare[];
  return shares.find((s) => s.upload_key === uploadKey) ?? null;
}
