import { vi, type Mocked } from 'vitest';
import { SaveNativeDeckUseCase } from './SaveNativeDeckUseCase';
import { IUploadRepository } from '../../data_layer/UploadRespository';
import StorageHandler from '../../lib/storage/StorageHandler';
import Uploads, { UploadsId } from '../../data_layer/public/Uploads';

function makeRepository(): Mocked<IUploadRepository> {
  return {
    deleteUpload: vi.fn(),
    getUploadsByOwner: vi.fn(),
    findByIdAndOwner: vi.fn(),
    findByObjectId: vi.fn(),
    findByKey: vi.fn(),
    findAllByObjectIdAndOwner: vi.fn(),
    update: vi.fn(),
    getLastUploadForUser: vi.fn(),
    getLastReconvertibleUpload: vi.fn(),
    findByOwnerAndDedupeKey: vi.fn(),
    insertNativeDeck: vi.fn(),
    insertConvertedDeck: vi.fn(),
  };
}

function makeStorage(): Mocked<
  Pick<StorageHandler, 'uniqify' | 'uploadFile' | 'delete'>
> {
  return {
    uniqify: vi.fn().mockReturnValue('app-123-deck.apkg'),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
  };
}

function makeRow(overrides: Partial<Uploads> = {}): Uploads {
  return {
    id: 1 as UploadsId,
    owner: 42,
    key: 'app-123-deck.apkg',
    filename: 'Pharmacology.apkg',
    object_id: null,
    size_mb: 2,
    created_at: new Date('2026-06-03T00:00:00Z'),
    source: 'app',
    dedupe_key: 'hash-abc',
    dropped_image_count: null,
    image_drop_reason: null,
    ...overrides,
  };
}

describe('SaveNativeDeckUseCase', () => {
  const apkg = Buffer.from('apkg-bytes');

  it('uploads to S3 then inserts the row with object_id null and source app', async () => {
    const repository = makeRepository();
    const storage = makeStorage();
    repository.findByOwnerAndDedupeKey.mockResolvedValue(null);
    repository.insertNativeDeck.mockResolvedValue(makeRow());

    const useCase = new SaveNativeDeckUseCase(
      repository,
      storage as unknown as StorageHandler
    );

    const result = await useCase.execute({
      owner: 42,
      filename: 'Pharmacology.apkg',
      apkg,
      sizeMb: 2,
      dedupeKey: 'hash-abc',
    });

    const uploadOrder = storage.uploadFile.mock.invocationCallOrder[0];
    const insertOrder = repository.insertNativeDeck.mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(insertOrder);

    expect(storage.uploadFile).toHaveBeenCalledWith('app-123-deck.apkg', apkg);
    expect(repository.insertNativeDeck).toHaveBeenCalledWith({
      owner: 42,
      key: 'app-123-deck.apkg',
      filename: 'Pharmacology.apkg',
      size_mb: 2,
      dedupe_key: 'hash-abc',
    });
    expect(result).toEqual({
      key: 'app-123-deck.apkg',
      filename: 'Pharmacology.apkg',
      size_mb: 2,
    });
  });

  it('regenerates the storage key from owner, never trusting the client filename', async () => {
    const repository = makeRepository();
    const storage = makeStorage();
    repository.findByOwnerAndDedupeKey.mockResolvedValue(null);
    repository.insertNativeDeck.mockResolvedValue(makeRow());

    const useCase = new SaveNativeDeckUseCase(
      repository,
      storage as unknown as StorageHandler
    );

    await useCase.execute({
      owner: 42,
      filename: '../../etc/passwd.apkg',
      apkg,
      sizeMb: 2,
      dedupeKey: null,
    });

    expect(storage.uniqify).toHaveBeenCalledWith(
      '../../etc/passwd.apkg',
      '42',
      200,
      'apkg'
    );
    expect(storage.uploadFile).toHaveBeenCalledWith('app-123-deck.apkg', apkg);
  });

  it('does not insert a row when the S3 upload fails', async () => {
    const repository = makeRepository();
    const storage = makeStorage();
    repository.findByOwnerAndDedupeKey.mockResolvedValue(null);
    storage.uploadFile.mockRejectedValue(new Error('s3 down'));

    const useCase = new SaveNativeDeckUseCase(
      repository,
      storage as unknown as StorageHandler
    );

    await expect(
      useCase.execute({
        owner: 42,
        filename: 'Pharmacology.apkg',
        apkg,
        sizeMb: 2,
        dedupeKey: null,
      })
    ).rejects.toThrow('s3 down');

    expect(repository.insertNativeDeck).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('deletes the S3 object when the DB insert fails after a successful upload', async () => {
    const repository = makeRepository();
    const storage = makeStorage();
    repository.findByOwnerAndDedupeKey.mockResolvedValue(null);
    repository.insertNativeDeck.mockRejectedValue(new Error('insert failed'));

    const useCase = new SaveNativeDeckUseCase(
      repository,
      storage as unknown as StorageHandler
    );

    await expect(
      useCase.execute({
        owner: 42,
        filename: 'Pharmacology.apkg',
        apkg,
        sizeMb: 2,
        dedupeKey: null,
      })
    ).rejects.toThrow('insert failed');

    expect(storage.delete).toHaveBeenCalledWith('app-123-deck.apkg');
  });

  it('returns the existing row without uploading or inserting when dedupe_key already exists', async () => {
    const repository = makeRepository();
    const storage = makeStorage();
    repository.findByOwnerAndDedupeKey.mockResolvedValue(
      makeRow({ key: 'existing-key.apkg', size_mb: 5 })
    );

    const useCase = new SaveNativeDeckUseCase(
      repository,
      storage as unknown as StorageHandler
    );

    const result = await useCase.execute({
      owner: 42,
      filename: 'Pharmacology.apkg',
      apkg,
      sizeMb: 2,
      dedupeKey: 'hash-abc',
    });

    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(repository.insertNativeDeck).not.toHaveBeenCalled();
    expect(result).toEqual({
      key: 'existing-key.apkg',
      filename: 'Pharmacology.apkg',
      size_mb: 5,
    });
  });
});
