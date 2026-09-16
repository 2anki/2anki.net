import deleteOldUploads from './deleteOldUploads';
import { safeParseAttachments } from './deleteOldUploads';

function makeStorage() {
  return { delete: jest.fn().mockResolvedValue(true) };
}

function makeDb(feedbackRows: { attachments: unknown }[] = []) {
  const selectWhereChain = {
    where: jest.fn().mockResolvedValue(feedbackRows),
  };
  const deleteWhereChain = {
    delete: jest.fn().mockResolvedValue(feedbackRows.length),
  };

  const dbFn = jest.fn().mockImplementation((table: string) => {
    if (table === 'feedback') {
      return {
        select: jest.fn().mockReturnValue(selectWhereChain),
        where: jest.fn().mockReturnValue(deleteWhereChain),
      };
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

jest.mock('./deleteNonSubScriberUploadsInDatabase', () => ({
  deleteNonSubScriberUploadsInDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./deleteDanglingUploadsInBucket', () => ({
  deleteDanglingUploadsInBucket: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./deleteDeadUploadRowsInDatabase', () => ({
  deleteDeadUploadRowsInDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../StorageHandler', () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import StorageHandler from '../../StorageHandler';
import { deleteDeadUploadRowsInDatabase } from './deleteDeadUploadRowsInDatabase';

describe('deleteResolvedFeedbackAttachments (via deleteOldUploads)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips storage.delete when attachments is null; still deletes the DB row', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as jest.Mock).mockImplementation(() => storage);
    const { dbFn, deleteWhereChain } = makeDb([{ attachments: null }]);

    await deleteOldUploads(dbFn);

    expect(storage.delete).not.toHaveBeenCalled();
    expect(deleteWhereChain.delete).toHaveBeenCalled();
  });

  it('calls storage.delete for each key in a valid attachments array', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as jest.Mock).mockImplementation(() => storage);
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
    (StorageHandler as unknown as jest.Mock).mockImplementation(() => storage);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
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
    (StorageHandler as unknown as jest.Mock).mockImplementation(() => storage);
    const { dbFn, deleteWhereChain } = makeDb([
      { attachments: '["x.png"]' },
      { attachments: null },
    ]);

    await deleteOldUploads(dbFn);

    expect(deleteWhereChain.delete).toHaveBeenCalledTimes(1);
  });

  it('runs the dead-upload-row backstop as part of the daily sweep', async () => {
    const storage = makeStorage();
    (StorageHandler as unknown as jest.Mock).mockImplementation(() => storage);
    const { dbFn } = makeDb([]);

    await deleteOldUploads(dbFn);

    expect(deleteDeadUploadRowsInDatabase).toHaveBeenCalledTimes(1);
    expect(deleteDeadUploadRowsInDatabase).toHaveBeenCalledWith(dbFn, storage);
  });
});
