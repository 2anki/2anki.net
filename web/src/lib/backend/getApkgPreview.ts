import { get } from './api';

export interface ApkgEditableField {
  fieldIndex: number;
  fieldName: string;
  value: string;
}

export interface ApkgPreviewCard {
  id: number;
  ord: number;
  templateName: string;
  deckName: string;
  deckPath: string[];
  noteTypeName: string;
  css: string;
  front: string;
  back: string;
  editable?: {
    front: ApkgEditableField | null;
    back: ApkgEditableField | null;
  };
  noteHasOtherCards?: boolean;
}

export interface ApkgPreviewBatch {
  cards: ApkgPreviewCard[];
  nextCursor: number | null;
  total: number;
}

export interface ApkgDeckMeta {
  id: number;
  fullName: string;
  path: string[];
  cardCount: number;
}

export interface ApkgPreviewMeta {
  totalCards: number;
  decks: ApkgDeckMeta[];
}

export async function getApkgPreviewMeta(
  key: string
): Promise<ApkgPreviewMeta> {
  const url = `/api/apkg/${encodeURIComponent(key)}/meta`;
  return (await get(url)) as ApkgPreviewMeta;
}

export async function getApkgPreviewBatch(
  key: string,
  cursor: number | null,
  options: { pageSize?: number; deckId?: number | null } = {}
): Promise<ApkgPreviewBatch> {
  const { pageSize = 20, deckId = null } = options;
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', String(cursor));
  params.set('page_size', String(pageSize));
  if (deckId != null) params.set('deck_id', String(deckId));
  const url = `/api/apkg/${encodeURIComponent(key)}/cards?${params.toString()}`;
  return (await get(url)) as ApkgPreviewBatch;
}
