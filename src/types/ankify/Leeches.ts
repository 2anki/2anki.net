export interface LeechNoteField {
  name: string;
  value: string;
}

export interface LeechNote {
  noteId: number;
  deckName: string;
  modelName: string;
  fields: LeechNoteField[];
  tags: string[];
  lapses: number;
  suspended: boolean;
}

export interface ListLeechesOffline {
  connected: false;
}

export interface ListLeechesConnected {
  connected: true;
  leeches: LeechNote[];
}

export type ListLeechesResult = ListLeechesOffline | ListLeechesConnected;
