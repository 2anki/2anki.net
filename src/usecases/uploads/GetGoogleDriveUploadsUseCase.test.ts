import { vi } from 'vitest';
import { GetGoogleDriveUploadsUseCase } from './GetGoogleDriveUploadsUseCase';
import {
  GoogleDriveRepository,
  GoogleDriveUploadRow,
} from '../../data_layer/GoogleDriveRepository';

describe('GetGoogleDriveUploadsUseCase', () => {
  function makeRepo(rows: GoogleDriveUploadRow[]): GoogleDriveRepository {
    return {
      getByOwner: vi.fn().mockResolvedValue(rows),
    } as unknown as GoogleDriveRepository;
  }

  it('returns mapped rows with description/embedUrl/owner omitted', async () => {
    const repo = makeRepo([
      {
        id: 'abc123',
        iconUrl: 'https://drive-thirdparty.googleusercontent.com/16/type/pdf',
        mimeType: 'application/pdf',
        name: 'biology-chapter-7.pdf',
        sizeBytes: '2457600',
        url: 'https://drive.google.com/file/d/abc123/view',
        owner: 42,
        last_converted_at: '2026-05-14T00:00:00Z',
      },
    ]);
    const useCase = new GetGoogleDriveUploadsUseCase(repo);
    const result = await useCase.execute(42, 10, 0);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'abc123',
      iconUrl: 'https://drive-thirdparty.googleusercontent.com/16/type/pdf',
      mimeType: 'application/pdf',
      name: 'biology-chapter-7.pdf',
      sizeBytes: '2457600',
      url: 'https://drive.google.com/file/d/abc123/view',
      last_converted_at: '2026-05-14T00:00:00Z',
    });
    expect(result[0]).not.toHaveProperty('owner');
    expect(result[0]).not.toHaveProperty('description');
    expect(result[0]).not.toHaveProperty('embedUrl');
  });

  it('passes limit and offset to repository', async () => {
    const repo = makeRepo([]);
    const useCase = new GetGoogleDriveUploadsUseCase(repo);
    await useCase.execute(7, 10, 20);
    expect(repo.getByOwner).toHaveBeenCalledWith(7, 10, 20);
  });

  it('returns empty array when repository returns no rows', async () => {
    const repo = makeRepo([]);
    const useCase = new GetGoogleDriveUploadsUseCase(repo);
    const result = await useCase.execute(7, 10, 0);
    expect(result).toEqual([]);
  });
});
