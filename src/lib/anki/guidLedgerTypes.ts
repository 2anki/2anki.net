export interface IssuedCardGuid {
  blockId: string;
  sourcePageId?: string;
  guid: string;
}

export type KnownGuids = Record<string, string>;
