export interface DeckMaturityOffline {
  connected: false;
}

export interface DeckMaturityConnected {
  connected: true;
  matureCount: number;
  total: number;
  avgIntervalDays: number;
}

export type DeckMaturityResult = DeckMaturityOffline | DeckMaturityConnected;
