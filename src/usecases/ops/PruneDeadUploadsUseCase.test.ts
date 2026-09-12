import {
  IPruneStorageHandler,
  IPruneUploadRepository,
  PruneDeadUploadsUseCase,
  UnsafeBucketListingError,
  UploadReference,
} from './PruneDeadUploadsUseCase';

const rows: UploadReference[] = [
  { id: 1, key: 'decks/exists-1.apkg', owner: 10 },
  { id: 2, key: 'decks/missing-1.apkg', owner: 20 },
  { id: 3, key: 'decks/missing-2.apkg', owner: 30 },
  { id: 4, key: 'mindmaps/reserved.png', owner: 40 },
  { id: 5, key: 'decks/exists-2.apkg', owner: 10 },
];

const bucketKeys = ['decks/exists-1.apkg', 'decks/exists-2.apkg'];

function makeStorage(keys: string[]): IPruneStorageHandler {
  return {
    getContents: async () => keys.map((key) => ({ Key: key })),
  };
}

function makeRepository(uploadRows: UploadReference[]) {
  const deleteUpload = jest.fn(async () => 1);
  const repo: IPruneUploadRepository = {
    getAllUploadReferences: async () => uploadRows,
    deleteUpload,
  };
  return { repo, deleteUpload };
}

describe('PruneDeadUploadsUseCase', () => {
  it('dry-run reports the missing-key rows and deletes nothing', async () => {
    const { repo, deleteUpload } = makeRepository(rows);
    const useCase = new PruneDeadUploadsUseCase(repo, makeStorage(bucketKeys));

    const result = await useCase.execute(true);

    expect(result).toEqual({
      dryRun: true,
      missingRows: 2,
      sampleKeys: ['decks/missing-1.apkg', 'decks/missing-2.apkg'],
    });
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it('caps the dry-run sample at five keys', async () => {
    const many: UploadReference[] = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      key: `decks/gone-${index}.apkg`,
      owner: 99,
    }));
    const { repo } = makeRepository(many);
    const useCase = new PruneDeadUploadsUseCase(
      repo,
      makeStorage(['decks/unrelated-live.apkg'])
    );

    const result = await useCase.execute(true);

    expect(result).toMatchObject({ dryRun: true, missingRows: 8 });
    expect((result as { sampleKeys: string[] }).sampleKeys).toHaveLength(5);
  });

  it('live run deletes exactly the missing-key rows, keeping existing and reserved keys', async () => {
    const { repo, deleteUpload } = makeRepository(rows);
    const useCase = new PruneDeadUploadsUseCase(repo, makeStorage(bucketKeys));

    const result = await useCase.execute(false);

    expect(result).toEqual({ dryRun: false, deleted: 2 });
    expect(deleteUpload).toHaveBeenCalledTimes(2);
    expect(deleteUpload).toHaveBeenCalledWith(20, 'decks/missing-1.apkg');
    expect(deleteUpload).toHaveBeenCalledWith(30, 'decks/missing-2.apkg');
    expect(deleteUpload).not.toHaveBeenCalledWith(10, 'decks/exists-1.apkg');
    expect(deleteUpload).not.toHaveBeenCalledWith(40, 'mindmaps/reserved.png');
  });

  it('refuses to judge rows when the bucket listing is empty', async () => {
    const { repo, deleteUpload } = makeRepository(rows);
    const useCase = new PruneDeadUploadsUseCase(repo, makeStorage([]));

    await expect(useCase.execute(false)).rejects.toBeInstanceOf(
      UnsafeBucketListingError
    );
    await expect(useCase.execute(true)).rejects.toBeInstanceOf(
      UnsafeBucketListingError
    );
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it('refuses to judge rows when the bucket listing hit the paging cap', async () => {
    const { repo, deleteUpload } = makeRepository(rows);
    const capped = Array.from({ length: 100_000 }, (_, i) => `decks/${i}.apkg`);
    const useCase = new PruneDeadUploadsUseCase(repo, makeStorage(capped));

    await expect(useCase.execute(false)).rejects.toBeInstanceOf(
      UnsafeBucketListingError
    );
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});
