import UploadRepository from './UploadRespository';

describe('UploadRepository owner guards', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  function makeRepo() {
    const called: string[] = [];
    const db = () => {
      called.push('db(table)');
      return {
        where: () => {
          called.push('where');
          return {
            orderBy: () => ({ returning: () => Promise.resolve([]) }),
          };
        },
        del: () => ({ where: () => Promise.resolve(0) }),
      };
    };
    return { repo: new UploadRepository(db as unknown as never), called };
  }

  it('returns empty list and skips query when owner is undefined', async () => {
    const { repo, called } = makeRepo();
    const result = await repo.getUploadsByOwner(undefined as unknown as number);
    expect(result).toEqual([]);
    expect(called).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns 0 and skips delete when owner is null', async () => {
    const { repo, called } = makeRepo();
    const result = await repo.deleteUpload(
      null as unknown as number,
      'some-key'
    );
    expect(result).toBe(0);
    expect(called).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe('UploadRepository.getAllUploadReferences', () => {
  it('returns id, key and owner for rows with a non-empty key', async () => {
    const dbRows = [
      { id: 1, key: 'decks/a.apkg', owner: 10 },
      { id: 2, key: null, owner: 20 },
      { id: 3, key: '', owner: 30 },
      { id: 4, key: 'decks/b.apkg', owner: 40 },
    ];
    const db = () => ({
      select: () => ({
        whereNotNull: () => Promise.resolve(dbRows),
      }),
    });
    const repo = new UploadRepository(db as unknown as never);

    const result = await repo.getAllUploadReferences();

    expect(result).toEqual([
      { id: 1, key: 'decks/a.apkg', owner: 10 },
      { id: 4, key: 'decks/b.apkg', owner: 40 },
    ]);
  });
});

describe('UploadRepository.findByObjectId', () => {
  it('returns null and skips the query when the object id is null', async () => {
    let queried = false;
    const db = () => {
      queried = true;
      return {} as never;
    };
    const repo = new UploadRepository(db as unknown as never);
    const result = await repo.findByObjectId(null as unknown as string);
    expect(result).toBeNull();
    expect(queried).toBe(false);
  });
});
