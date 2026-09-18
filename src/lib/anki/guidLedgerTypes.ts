export interface IssuedCardGuid {
  blockId: string;
  sourcePageId?: string;
  guid: string;
  // Epoch seconds this identity key's content last changed. Only the
  // upload-identity (u:) path writes it; Notion block-id entries omit it.
  contentChangedAt?: number;
}

export type KnownGuids = Record<string, string>;
