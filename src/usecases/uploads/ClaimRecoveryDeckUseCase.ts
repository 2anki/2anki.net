import {
  ANON_RECOVERY_RETENTION_MS,
  anonRecoveryKey,
} from '../../lib/upload/anonymousRecovery';

export class NoRecoveryDeckError extends Error {
  constructor() {
    super('No recovery deck for this visitor');
    this.name = 'NoRecoveryDeckError';
  }
}

export class RecoveryClaimInProgressError extends Error {
  constructor() {
    super('Another claim for this deck is still running');
    this.name = 'RecoveryClaimInProgressError';
  }
}

export class RecoveryDeckNotSavedError extends Error {
  constructor() {
    super('The recovered deck could not be saved to the account');
    this.name = 'RecoveryDeckNotSavedError';
  }
}

export interface RecoveryDeckStore {
  listObjectsByPrefix(
    prefix: string
  ): Promise<{ Key: string; LastModified?: Date }[]>;
  getFileContents(key: string): Promise<{ Body: Buffer | undefined }>;
  delete(key: string): Promise<boolean>;
}

export interface RecoveredDeckSaver {
  saveRecoveredDeck(
    owner: string,
    deckName: string,
    apkg: Buffer,
    requestId: string | undefined
  ): Promise<string | null>;
}

export interface ClaimRecoveryDeckParams {
  anonId: string | null;
  recoveryToken: string;
  deckName: string;
  owner: string;
  requestId: string | undefined;
}

export interface ClaimedRecoveryDeck {
  downloadKey: string;
  deckName: string;
}

function isMissingObjectError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.includes('NoSuchKey');
}

// A signed-out pass holder's deck is kept for a day under a key only their
// browser can rebuild (anon_id cookie + per-upload token). Once they have an
// account, that copy moves into My decks and the anonymous copy is deleted, so
// a second claim finds nothing and never adds a second row. A claim that
// overlaps one already running for the same key is refused rather than
// loading the deck into memory twice; production serves from one process.
export class ClaimRecoveryDeckUseCase {
  private readonly claimsInFlight = new Set<string>();

  constructor(
    private readonly store: RecoveryDeckStore,
    private readonly saver: RecoveredDeckSaver,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(params: ClaimRecoveryDeckParams): Promise<ClaimedRecoveryDeck> {
    const { anonId, recoveryToken, deckName, owner, requestId } = params;
    if (anonId == null) {
      throw new NoRecoveryDeckError();
    }
    const key = anonRecoveryKey(anonId, recoveryToken);
    if (this.claimsInFlight.has(key)) {
      throw new RecoveryClaimInProgressError();
    }
    this.claimsInFlight.add(key);
    try {
      return await this.moveDeck(key, deckName, owner, requestId);
    } finally {
      this.claimsInFlight.delete(key);
    }
  }

  private async moveDeck(
    key: string,
    deckName: string,
    owner: string,
    requestId: string | undefined
  ): Promise<ClaimedRecoveryDeck> {
    if (!(await this.isWithinWindow(key))) {
      throw new NoRecoveryDeckError();
    }
    const apkg = await this.readDeck(key);
    const downloadKey = await this.saver.saveRecoveredDeck(
      owner,
      deckName,
      apkg,
      requestId
    );
    if (downloadKey == null) {
      throw new RecoveryDeckNotSavedError();
    }
    if (!(await this.store.delete(key))) {
      console.warn(
        '[ClaimRecoveryDeck] moved a deck but could not delete the kept copy'
      );
    }
    return { downloadKey, deckName };
  }

  private async isWithinWindow(key: string): Promise<boolean> {
    const objects = await this.store.listObjectsByPrefix(key);
    const stored = objects.find((object) => object.Key === key);
    if (stored?.LastModified == null) {
      return false;
    }
    const age = this.now().getTime() - stored.LastModified.getTime();
    return age < ANON_RECOVERY_RETENTION_MS;
  }

  private async readDeck(key: string): Promise<Buffer> {
    try {
      const { Body } = await this.store.getFileContents(key);
      if (Body == null) {
        throw new NoRecoveryDeckError();
      }
      return Body;
    } catch (error) {
      if (isMissingObjectError(error)) {
        throw new NoRecoveryDeckError();
      }
      throw error;
    }
  }
}

export default ClaimRecoveryDeckUseCase;
