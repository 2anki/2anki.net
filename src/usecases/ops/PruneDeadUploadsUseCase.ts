import { isReservedKey } from '../../lib/storage/jobs/helpers/isDeletableBucketKey';

export interface UploadReference {
  id: number;
  key: string;
  owner: number;
}

export interface IPruneUploadRepository {
  getAllUploadReferences(): Promise<UploadReference[]>;
  deleteUpload(owner: number, key: string): Promise<number>;
}

export interface IPruneStorageHandler {
  getContents(maxKeys?: number): Promise<{ Key?: string }[] | undefined>;
}

export type PruneDeadUploadsResult =
  | { dryRun: true; missingRows: number; sampleKeys: string[] }
  | { dryRun: false; deleted: number };

const MAX_KEYS = 100_000;
const SAMPLE_LIMIT = 5;

// A listing that came back empty, or that hit the paging cap, cannot tell a
// dead row from a live one; every row would look dead and a live run would
// delete real decks. Refuse rather than guess.
export class UnsafeBucketListingError extends Error {
  constructor(reason: 'empty' | 'truncated') {
    super(
      reason === 'empty'
        ? 'The bucket listing came back empty, so no row can be judged dead.'
        : 'The bucket listing hit the paging cap, so rows past it cannot be judged.'
    );
    this.name = 'UnsafeBucketListingError';
  }
}

export class PruneDeadUploadsUseCase {
  constructor(
    private readonly uploads: IPruneUploadRepository,
    private readonly storage: IPruneStorageHandler
  ) {}

  async execute(dryRun: boolean): Promise<PruneDeadUploadsResult> {
    const storedFiles = (await this.storage.getContents(MAX_KEYS)) ?? [];
    const existingKeys = new Set<string>(
      storedFiles
        .map((file) => file.Key)
        .filter(
          (key): key is string => typeof key === 'string' && key.length > 0
        )
    );

    if (existingKeys.size === 0) {
      throw new UnsafeBucketListingError('empty');
    }
    if (storedFiles.length >= MAX_KEYS) {
      throw new UnsafeBucketListingError('truncated');
    }

    const rows = await this.uploads.getAllUploadReferences();
    const deadRows = rows.filter(
      (row) => !isReservedKey(row.key) && !existingKeys.has(row.key)
    );

    if (dryRun) {
      return {
        dryRun: true,
        missingRows: deadRows.length,
        sampleKeys: deadRows.slice(0, SAMPLE_LIMIT).map((row) => row.key),
      };
    }

    let deleted = 0;
    for (const row of deadRows) {
      deleted += await this.uploads.deleteUpload(row.owner, row.key);
    }
    return { dryRun: false, deleted };
  }
}
