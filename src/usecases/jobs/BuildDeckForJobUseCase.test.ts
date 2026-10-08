import { vi, type Mock, type Mocked, type MockedClass } from 'vitest';
import { BuildDeckForJobUseCase } from './BuildDeckForJobUseCase';
import { EmptyDeckError } from './EmptyDeckError';
import JobRepository from '../../data_layer/JobRepository';
import { IUploadRepository } from '../../data_layer/UploadRespository';
import Uploads from '../../data_layer/public/Uploads';
import Deck from '../../lib/parser/Deck';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import BlockHandler from '../../services/NotionService/BlockHandler/BlockHandler';
import Workspace from '../../lib/parser/WorkSpace';
import StorageHandler from '../../lib/storage/StorageHandler';
import CardOption from '../../lib/parser/Settings';
import CardGenerator from '../../lib/anki/CardGenerator';
import fsPromises from 'node:fs/promises';
import { getDatabase } from '../../data_layer';

vi.mock('../../lib/anki/CardGenerator');
vi.mock('../../data_layer', function () {
  return {
    getDatabase: vi.fn(),
  };
});
vi.mock('node:fs/promises', function () {
  return {
    __esModule: true,
    default: { readFile: vi.fn() },
    readFile: vi.fn(),
  };
});
vi.mock('../../lib/misc/file', function () {
  return {
    FileSizeInMegaBytes: vi.fn().mockReturnValue(1),
  };
});

function buildUploadRepository(): Mocked<IUploadRepository> {
  return {
    deleteUpload: vi.fn().mockResolvedValue(1),
    getUploadsByOwner: vi.fn().mockResolvedValue([]),
    findByIdAndOwner: vi.fn().mockResolvedValue(null),
    findByObjectId: vi.fn().mockResolvedValue(null),
    findByKey: vi.fn().mockResolvedValue(null),
    findAllByObjectIdAndOwner: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue([]),
    getLastUploadForUser: vi.fn().mockResolvedValue(null),
    getLastReconvertibleUpload: vi.fn().mockResolvedValue(null),
    findByOwnerAndDedupeKey: vi.fn().mockResolvedValue(null),
    insertNativeDeck: vi.fn(),
    insertConvertedDeck: vi.fn(),
  };
}

describe('BuildDeckForJobUseCase', () => {
  const jobRepository = {
    updateJobStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as JobRepository;

  const exporter = {
    configure: vi.fn(),
  } as unknown as CustomExporter;

  const bl = {
    firstPageTitle: 'Title',
    emptyDeckReason: () => 'no_toggles',
  } as unknown as BlockHandler;
  const ws = { location: '/tmp/ws' } as unknown as Workspace;
  const settings = { deckName: 'Deck' } as unknown as CardOption;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws EmptyDeckError when every deck has zero cards and never invokes CardGenerator', async () => {
    const storage = {
      uniqify: vi.fn(),
      uploadFile: vi.fn(),
      delete: vi.fn(),
    } as unknown as StorageHandler;
    const uploadRepository = buildUploadRepository();
    const useCase = new BuildDeckForJobUseCase(jobRepository, uploadRepository);
    const decks: Deck[] = [
      { cards: [] } as unknown as Deck,
      { cards: [] } as unknown as Deck,
    ];

    await expect(
      useCase.execute({
        bl,
        exporter,
        decks,
        ws,
        settings,
        storage,
        id: 'job-1',
        owner: 'owner-1',
      })
    ).rejects.toBeInstanceOf(EmptyDeckError);

    expect(CardGenerator).not.toHaveBeenCalled();
    expect(exporter.configure).not.toHaveBeenCalled();
    expect(uploadRepository.findAllByObjectIdAndOwner).not.toHaveBeenCalled();
  });

  describe('prior-upload prune on re-conversion', () => {
    const MockCardGenerator = CardGenerator as MockedClass<
      typeof CardGenerator
    >;
    const mockReadFile = fsPromises.readFile as Mock;
    const mockGetDatabase = getDatabase as Mock;

    beforeEach(() => {
      MockCardGenerator.mockImplementation(function () {
        return {
          run: vi.fn().mockResolvedValue('/tmp/ws/deck.apkg'),
        } as unknown as InstanceType<typeof CardGenerator>;
      });
      mockReadFile.mockResolvedValue(Buffer.from('apkg-bytes'));
      mockGetDatabase.mockReturnValue(function () {
        return {
          insert: vi.fn().mockResolvedValue(1),
        };
      });
    });

    it('deletes the S3 object and DB row for every prior upload after inserting the new one', async () => {
      const storage = {
        uniqify: vi.fn().mockReturnValue('new-key.apkg'),
        uploadFile: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
      } as unknown as StorageHandler;
      const uploadRepository = buildUploadRepository();
      uploadRepository.findAllByObjectIdAndOwner.mockResolvedValue([
        { id: 1, owner: 7, key: 'old-1.apkg', object_id: 'page-x' } as Uploads,
        { id: 2, owner: 7, key: 'old-2.apkg', object_id: 'page-x' } as Uploads,
      ]);

      const useCase = new BuildDeckForJobUseCase(
        jobRepository,
        uploadRepository
      );
      await useCase.execute({
        bl,
        exporter,
        decks: [{ cards: [{}] }] as unknown as Deck[],
        ws,
        settings,
        storage,
        id: 'page-x',
        owner: '7',
      });

      expect(uploadRepository.findAllByObjectIdAndOwner).toHaveBeenCalledWith(
        'page-x',
        7
      );
      expect(storage.delete).toHaveBeenCalledWith('old-1.apkg');
      expect(storage.delete).toHaveBeenCalledWith('old-2.apkg');
      expect(uploadRepository.deleteUpload).toHaveBeenCalledWith(
        7,
        'old-1.apkg'
      );
      expect(uploadRepository.deleteUpload).toHaveBeenCalledWith(
        7,
        'old-2.apkg'
      );
    });

    it('makes no prune calls when there are no prior uploads', async () => {
      const storage = {
        uniqify: vi.fn().mockReturnValue('new-key.apkg'),
        uploadFile: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
      } as unknown as StorageHandler;
      const uploadRepository = buildUploadRepository();

      const useCase = new BuildDeckForJobUseCase(
        jobRepository,
        uploadRepository
      );
      await useCase.execute({
        bl,
        exporter,
        decks: [{ cards: [{}] }] as unknown as Deck[],
        ws,
        settings,
        storage,
        id: 'page-x',
        owner: '7',
      });

      expect(storage.delete).not.toHaveBeenCalled();
      expect(uploadRepository.deleteUpload).not.toHaveBeenCalled();
    });

    it('keeps going when a prune step throws (best-effort cleanup)', async () => {
      const storage = {
        uniqify: vi.fn().mockReturnValue('new-key.apkg'),
        uploadFile: vi.fn().mockResolvedValue(undefined),
        delete: vi
          .fn()
          .mockRejectedValueOnce(new Error('s3 boom'))
          .mockResolvedValue(true),
      } as unknown as StorageHandler;
      const uploadRepository = buildUploadRepository();
      uploadRepository.findAllByObjectIdAndOwner.mockResolvedValue([
        { id: 1, owner: 7, key: 'old-1.apkg', object_id: 'page-x' } as Uploads,
        { id: 2, owner: 7, key: 'old-2.apkg', object_id: 'page-x' } as Uploads,
      ]);
      const consoleErr = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      const useCase = new BuildDeckForJobUseCase(
        jobRepository,
        uploadRepository
      );
      await useCase.execute({
        bl,
        exporter,
        decks: [{ cards: [{}] }] as unknown as Deck[],
        ws,
        settings,
        storage,
        id: 'page-x',
        owner: '7',
      });

      expect(storage.delete).toHaveBeenCalledWith('old-2.apkg');
      expect(uploadRepository.deleteUpload).toHaveBeenCalledWith(
        7,
        'old-2.apkg'
      );
      consoleErr.mockRestore();
    });
  });
});
