import { vi, type Mock } from 'vitest';
import {
  ResolveMcpDeckDownloadUseCase,
  DeckPresigner,
} from './ResolveMcpDeckDownloadUseCase';
import { IUploadRepository } from '../../data_layer/UploadRespository';
import Uploads, { UploadsId } from '../../data_layer/public/Uploads';

function makeRow(overrides: Partial<Uploads> = {}): Uploads {
  return {
    id: 1 as UploadsId,
    owner: 42,
    key: 'owner-42-deck.apkg',
    filename: 'Pharmacology.apkg',
    object_id: 'obj-1',
    size_mb: 2,
    created_at: new Date('2026-07-19T00:00:00Z'),
    source: 'app',
    dedupe_key: null,
    dropped_image_count: null,
    image_drop_reason: null,
    ...overrides,
  };
}

function makeUseCase(overrides: {
  findByObjectId?: Mock;
  getPresignedUrl?: DeckPresigner['getPresignedUrl'];
}) {
  const findByObjectId =
    overrides.findByObjectId ?? vi.fn(async () => makeRow());
  const uploads = { findByObjectId } as unknown as IUploadRepository;
  const getPresignedUrl =
    overrides.getPresignedUrl ??
    vi.fn(async () => 'https://spaces.example/signed');
  const storage: DeckPresigner = { getPresignedUrl };
  return {
    useCase: new ResolveMcpDeckDownloadUseCase(uploads, storage),
    findByObjectId,
    getPresignedUrl,
  };
}

describe('ResolveMcpDeckDownloadUseCase', () => {
  it('presigns the row key with a 300s TTL and the filename disposition', async () => {
    const { useCase, getPresignedUrl } = makeUseCase({});
    const result = await useCase.resolve('obj-1');
    expect(result).toEqual({
      kind: 'redirect',
      url: 'https://spaces.example/signed',
      owner: 42,
    });
    expect(getPresignedUrl).toHaveBeenCalledWith(
      'owner-42-deck.apkg',
      300,
      'Pharmacology.apkg'
    );
  });

  it('falls back to deck.apkg for the disposition when the filename is null', async () => {
    const { useCase, getPresignedUrl } = makeUseCase({
      findByObjectId: vi.fn(async () => makeRow({ filename: null })),
    });
    await useCase.resolve('obj-1');
    expect(getPresignedUrl).toHaveBeenCalledWith(
      'owner-42-deck.apkg',
      300,
      'deck.apkg'
    );
  });

  it('returns not_found when the row is missing', async () => {
    const { useCase, getPresignedUrl } = makeUseCase({
      findByObjectId: vi.fn(async () => null),
    });
    const result = await useCase.resolve('obj-1');
    expect(result).toEqual({ kind: 'not_found' });
    expect(getPresignedUrl).not.toHaveBeenCalled();
  });

  it('returns not_found without presigning when the key is null', async () => {
    const { useCase, getPresignedUrl } = makeUseCase({
      findByObjectId: vi.fn(async () =>
        makeRow({ key: null as unknown as string })
      ),
    });
    const result = await useCase.resolve('obj-1');
    expect(result).toEqual({ kind: 'not_found' });
    expect(getPresignedUrl).not.toHaveBeenCalled();
  });
});
