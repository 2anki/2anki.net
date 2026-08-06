import type { IssuedCardGuid } from '../anki/guidLedgerTypes';
import type { ConversionEngine } from './conversionEngine';
import type { InducedRescue } from './induction/candidateRules';
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

  expiredNotionImageCount = 0;

  // Set by PrepareDeck, inside whichever branch produced the deck. The parent
  // process persists them — the worker pool has no database handle.
  engine?: ConversionEngine;

  score?: DeckScore;

  // Card GUIDs issued during this conversion that the user's ledger does not
  // hold yet. The parent process persists them — no database in the worker.
  guidEntries?: IssuedCardGuid[];

  // Set when the empty-deck structure rescue ran. Carries the winning (or
  // best-attempted) rule so the corpus records which structure rescued the
  // upload and whether it shipped or fell below the floor.
  inducedRule?: InducedRescue;

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
