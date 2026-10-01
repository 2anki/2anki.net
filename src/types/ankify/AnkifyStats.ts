export interface AnkifyStatsDeck {
  fullName: string;
  name: string;
  depth: number;
  new: number;
  learning: number;
  review: number;
  total: number;
}

export interface AnkifyStatsReviewDay {
  date: string;
  count: number;
}

export interface AnkifyStatsOffline {
  connected: false;
}

export interface AnkifyStatsConnected {
  connected: true;
  reviewedToday: number;
  reviewedThisYear: number;
  currentStreak: number;
  longestStreak: number;
  reviewsByDay: AnkifyStatsReviewDay[];
  decks: AnkifyStatsDeck[];
}

export type AnkifyStatsResult = AnkifyStatsOffline | AnkifyStatsConnected;
