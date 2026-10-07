import { vi, type Mock, type Mocked, type MockedClass } from 'vitest';
import { ImportNotionImagesUseCase } from './ImportNotionImagesUseCase';
import NotionAPIWrapper from '../../services/NotionService/NotionAPIWrapper';
import instrumentedAxios from '../../services/observability/instrumentedAxios';
import StorageHandler from '../../lib/storage/StorageHandler';

vi.mock('../../services/NotionService/NotionAPIWrapper');
vi.mock('../../services/observability/instrumentedAxios', function () {
  return {
    __esModule: true,
    default: { get: vi.fn() },
  };
});
vi.mock('../../lib/storage/StorageHandler');

const MockNotionAPIWrapper = NotionAPIWrapper as MockedClass<
  typeof NotionAPIWrapper
>;
const mockGet = instrumentedAxios.get as Mock;
let mockStorage: Mocked<StorageHandler>;
let mockGetBlock: Mock;

const VALID_ID = '12345678-1234-1234-1234-123456789012';
const TOKEN = 'secret_abc';
const USER_ID = '7';

function makeImageBlock(url: string) {
  return {
    object: 'block',
    id: VALID_ID,
    type: 'image',
    image: { type: 'file', file: { url }, caption: [] },
    parent: { type: 'page_id', page_id: 'parent' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: '' },
    last_edited_by: { object: 'user', id: '' },
    has_children: false,
    archived: false,
    in_trash: false,
  };
}

function makeAxiosResponse(contentType: string, data: Buffer) {
  return { data, headers: { 'content-type': contentType }, status: 200 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBlock = vi.fn();
  MockNotionAPIWrapper.mockImplementation(function () {
    return { getBlock: mockGetBlock } as unknown as NotionAPIWrapper;
  });
  mockStorage = {
    uploadFile: vi.fn().mockResolvedValue({}),
    getPresignedUrl: vi
      .fn()
      .mockResolvedValue('https://presigned.example.com/img.png'),
  } as unknown as Mocked<StorageHandler>;
});

describe('ImportNotionImagesUseCase', () => {
  it('returns s3Key and presignedUrl for a valid image block', async () => {
    const useCase = new ImportNotionImagesUseCase(mockStorage);
    mockGetBlock.mockResolvedValue(
      makeImageBlock('https://prod-files.s3.amazonaws.com/img.png')
    );
    mockGet.mockResolvedValue(
      makeAxiosResponse('image/png', Buffer.from('png-data'))
    );

    const results = await useCase.execute([VALID_ID], USER_ID, TOKEN);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      s3Key: expect.stringMatching(/^io-drafts\/7\/.+\.png$/),
      presignedUrl: 'https://presigned.example.com/img.png',
    });
    expect(mockStorage.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('throws 401 when token is null', async () => {
    const useCase = new ImportNotionImagesUseCase(mockStorage);
    await expect(
      useCase.execute([VALID_ID], USER_ID, null)
    ).rejects.toMatchObject({ status: 401 });
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('throws 400 for an invalid blockId', async () => {
    const useCase = new ImportNotionImagesUseCase(mockStorage);
    await expect(
      useCase.execute(['not-a-uuid'], USER_ID, TOKEN)
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(mockGetBlock).not.toHaveBeenCalled();
  });

  it('skips block when content-type is not an allowed image MIME', async () => {
    const useCase = new ImportNotionImagesUseCase(mockStorage);
    mockGetBlock.mockResolvedValue(
      makeImageBlock('https://prod-files.s3.amazonaws.com/doc.pdf')
    );
    mockGet.mockResolvedValue(
      makeAxiosResponse('application/pdf', Buffer.from('pdf-data'))
    );

    const results = await useCase.execute([VALID_ID], USER_ID, TOKEN);

    expect(results).toHaveLength(0);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('skips block when image exceeds size cap', async () => {
    const useCase = new ImportNotionImagesUseCase(mockStorage);
    const bigBuf = Buffer.alloc(11 * 1024 * 1024);
    mockGetBlock.mockResolvedValue(
      makeImageBlock('https://prod-files.s3.amazonaws.com/big.png')
    );
    mockGet.mockResolvedValue(makeAxiosResponse('image/png', bigBuf));

    const results = await useCase.execute([VALID_ID], USER_ID, TOKEN);

    expect(results).toHaveLength(0);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('skips block when getImageUrl returns null', async () => {
    const useCase = new ImportNotionImagesUseCase(mockStorage);
    mockGetBlock.mockResolvedValue({
      object: 'block',
      id: VALID_ID,
      type: 'paragraph',
      paragraph: { rich_text: [] },
    });

    const results = await useCase.execute([VALID_ID], USER_ID, TOKEN);

    expect(results).toHaveLength(0);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
