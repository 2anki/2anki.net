import { vi, type Mock } from 'vitest';
import deleteOldUploads from './deleteOldUploads';
import { safeParseAttachments } from './deleteOldUploads';

function makeStorage() {
  return {
    delete: vi.fn().mockResolvedValue(true),
    listObjectsByPrefix: vi.fn().mockResolvedValue([]),
    deleteObjects: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDb(feedbackRows: { attachments: unknown }[] = []) {
  const selectWhereChain = {
    where: vi.fn().mockResolvedValue(feedbackRows),
  };
  const deleteWhereChain = {
    delete: vi.fn().mockResolvedValue(feedbackRows.length),
  };

  const dbFn = vi.fn().mockImplementation(function (table: string) {
    if (table === 'feedback') {
      return {
        select: vi.fn().mockReturnValue(selectWhereChain),
        where: vi.fn().mockReturnValue(deleteWhereChain),
      };
    }
    if (table === 'held_decks') {
      const heldDecksChain = {
        select: vi.fn(),
        where: vi.fn(),
        orWhere: vi.fn(),
        whereIn: vi.fn(),
        del: vi.fn().mockResolvedValue(0),
        then: (resolve: (rows: unknown[]) => void) => resolve([]),
      };
      heldDecksChain.select.mockReturnValue(heldDecksChain);
      heldDecksChain.where.mockReturnValue(heldDecksChain);
      heldDecksChain.orWhere.mockReturnValue(heldDecksChain);
      heldDecksChain.whereIn.mockReturnValue(heldDecksChain);
      return heldDecksChain;
    }
    return {};
  });

  return { dbFn: dbFn as unknown as import('knex').Knex, deleteWhereChain };
}

describe('safeParseAttachments', () => {
  it('returns [] for null', () => {
    expect(safeParseAttachments(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(safeParseAttachments(undefined)).toEqual([]);
  });

  it('returns [] for empty string', () => {
    expect(safeParseAttachments('')).toEqual([]);
  });

  it('returns [] for whitespace-only string', () => {
    expect(safeParseAttachments('   ')).toEqual([]);
  });

  it('returns [] for malformed JSON string', () => {
    expect(safeParseAttachments('[broken')).toEqual([]);
  });

  it('returns [] for a JSON object (not an array)', () => {
    expect(safeParseAttachments('{}')).toEqual([]);
  });

  it('returns the array for a valid JSON array of strings', () => {
    expect(safeParseAttachments('["a.png","b.png"]')).toEqual([
      'a.png',
      'b.png',
    ]);
  });

  it('returns the array when input is already a parsed JS array', () => {
    expect(safeParseAttachments(['a.png', 'b.png'])).toEqual([
      'a.png',
      'b.png',
    ]);
  });
});

vi.mock('./deleteNonSubScriberUploadsInDatabase', () => ({
  deleteNonSubScriberUploadsInDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./deleteDanglingUploadsInBucket', () => ({
  deleteDanglingUploadsInBucket: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./deleteDeadUploadRowsInDatabase', () => ({
  deleteDeadUploadRowsInDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../StorageHandler', () => {
  return {
    __esModule: true,
    default: vi.fn(),
  };
});

import StorageHandler from '../../StorageHandler';
import { deleteDeadUploadRowsInDatabase } from './deleteDeadUploadRowsInDatabase';

describe('deleteResolvedFeedbackAttachments (via deleteOldUploads)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips storage.delete when attachments is null; still deletes the DB row', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as Mock).mockImplementation(function () {
      return storage;
    });
    const { dbFn, deleteWhereChain } = makeDb([{ attachments: null }]);

    await deleteOldUploads(dbFn);

    expect(storage.delete).not.toHaveBeenCalled();
    expect(deleteWhereChain.delete).toHaveBeenCalled();
  });

  it('calls storage.delete for each key in a valid attachments array', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as Mock).mockImplementation(function () {
      return storage;
    });
    const { dbFn, deleteWhereChain } = makeDb([
      { attachments: ['a.png', 'b.png'] },
    ]);

    await deleteOldUploads(dbFn);

    expect(storage.delete).toHaveBeenCalledWith('a.png');
    expect(storage.delete).toHaveBeenCalledWith('b.png');
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(deleteWhereChain.delete).toHaveBeenCalled();
  });

  it('processes remaining rows when one row has malformed attachments', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as Mock).mockImplementation(function () {
      return storage;
    });
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(function () {});
    const { dbFn, deleteWhereChain } = makeDb([
      { attachments: '[broken' },
      { attachments: ['good.png'] },
    ]);

    await deleteOldUploads(dbFn);

    expect(storage.delete).toHaveBeenCalledWith('good.png');
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(deleteWhereChain.delete).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('deletes all acknowledged feedback rows from the DB after processing', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as Mock).mockImplementation(function () {
      return storage;
    });
    const { dbFn, deleteWhereChain } = makeDb([
      { attachments: '["x.png"]' },
      { attachments: null },
    ]);

    await deleteOldUploads(dbFn);

    expect(deleteWhereChain.delete).toHaveBeenCalledTimes(1);
  });

  it('runs the dead-upload-row backstop as part of the daily sweep', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as Mock).mockImplementation(function () {
      return storage;
    });
    const { dbFn } = makeDb([]);

    await deleteOldUploads(dbFn);

    expect(deleteDeadUploadRowsInDatabase).toHaveBeenCalledTimes(1);
    expect(deleteDeadUploadRowsInDatabase).toHaveBeenCalledWith(dbFn, storage);
  });

  it('sweeps expired held decks as part of the daily sweep', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as Mock).mockImplementation(function () {
      return storage;
    });
    const { dbFn } = makeDb([]);

    await deleteOldUploads(dbFn);

    expect(dbFn).toHaveBeenCalledWith('held_decks');
  });

  it('sweeps expired anonymous recovery decks as part of the daily sweep', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as Mock).mockImplementation(function () {
      return storage;
    });
    const { dbFn } = makeDb([]);

    await deleteOldUploads(dbFn);

    expect(storage.listObjectsByPrefix).toHaveBeenCalledWith('recover/');
  });
});
