import type { DeckScore } from './scoreCandidateDeck';

class Package {
  name: string;

  cardCount: number;

  mcqCount: number;

  mcqSkippedCount: number;

  droppedImageCount: number;

  emptyBackCount: number;

  parsePath?: string;

  overSplit = false;

  // Set by the conversion worker, where the parsed notes still exist. The
  // parent process persists it — the worker pool has no database handle.
  score?: DeckScore;

  constructor(
    name: string,
    cardCount: number = 0,
    mcqCount: number = 0,
    mcqSkippedCount: number = 0,
    droppedImageCount: number = 0,
    emptyBackCount: number = 0,
    parsePath?: string
  ) {
    this.name = name;
    this.cardCount = cardCount;
    this.mcqCount = mcqCount;
    this.mcqSkippedCount = mcqSkippedCount;
    this.droppedImageCount = droppedImageCount;
    this.emptyBackCount = emptyBackCount;
    this.parsePath = parsePath;
  }
}

export default Package;
