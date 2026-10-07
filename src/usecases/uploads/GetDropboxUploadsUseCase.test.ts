import { vi } from 'vitest';
import { GetDropboxUploadsUseCase } from './GetDropboxUploadsUseCase';
import {
  DropboxRepository,
  DropboxUploadRow,
} from '../../data_layer/DropboxRepository';

describe('GetDropboxUploadsUseCase', () => {
  function makeRepo(rows: DropboxUploadRow[]): DropboxRepository {
    return {
      getByOwner: vi.fn().mockResolvedValue(rows),
    } as unknown as DropboxRepository;
  }

  it('returns mapped rows with link omitted', async () => {
    const repo = makeRepo([
      {
        id: 1,
        bytes: 1024 * 1024 * 2,
        icon: 'page',
        dropbox_id: 'abc',
        isDir: false,
        linkType: 'direct',
        name: 'notes.pdf',
        owner: 42,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    const useCase = new GetDropboxUploadsUseCase(repo);
    const result = await useCase.execute(42, 10, 0);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 1,
      bytes: 1024 * 1024 * 2,
      name: 'notes.pdf',
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(result[0]).not.toHaveProperty('link');
    expect(result[0]).not.toHaveProperty('owner');
  });

  it('passes limit and offset to repository', async () => {
    const repo = makeRepo([]);
    const useCase = new GetDropboxUploadsUseCase(repo);
    await useCase.execute(7, 10, 20);
    expect(repo.getByOwner).toHaveBeenCalledWith(7, 10, 20);
  });

  it('returns empty array when repository returns no rows', async () => {
    const repo = makeRepo([]);
    const useCase = new GetDropboxUploadsUseCase(repo);
    const result = await useCase.execute(7, 10, 0);
    expect(result).toEqual([]);
  });
});
