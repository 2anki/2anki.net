import { vi, type Mock } from 'vitest';
import {
  CreateImageOcclusionDeckUseCase,
  CreateImageOcclusionDeckInput,
} from './CreateImageOcclusionDeckUseCase';

vi.mock('node:fs');
vi.mock('node:child_process');

const mockGetFileContents = vi.fn();
vi.mock('../../lib/storage/StorageHandler', () => ({
  default: class {
    getFileContents = mockGetFileContents;
  },
}));

import * as nodeFs from 'node:fs';
import * as nodeChildProcess from 'node:child_process';

const mockFs = vi.mocked(nodeFs);
const mockChild = vi.mocked(nodeChildProcess);

function buildInput(
  overrides: Partial<CreateImageOcclusionDeckInput> = {}
): CreateImageOcclusionDeckInput {
  return {
    deckName: 'Test Deck',
    mode: 'hide_all',
    images: [
      {
        imageName: 'img1.jpg',
        header: '',
        rects: [{ x: 0, y: 0, w: 10, h: 10, label: '' }],
      },
    ],
    imageFiles: [{ name: 'img1.jpg', path: '/tmp/img1.jpg' }],
    isPaying: true,
    ownerId: 7,
    ...overrides,
  };
}

function buildFourImageInput(): CreateImageOcclusionDeckInput {
  const images = Array.from({ length: 4 }, (_, i) => ({
    imageName: `img${i}.jpg`,
    header: '',
    rects: [{ x: 0, y: 0, w: 10, h: 10, label: '' }],
  }));
  const imageFiles = Array.from({ length: 4 }, (_, i) => ({
    name: `img${i}.jpg`,
    path: `/tmp/img${i}.jpg`,
  }));
  return buildInput({ images, imageFiles, isPaying: false });
}

describe('CreateImageOcclusionDeckUseCase', () => {
  describe('free tier limit enforcement', () => {
    it('rejects when a free user submits more than 3 images', async () => {
      const useCase = new CreateImageOcclusionDeckUseCase();
      await expect(useCase.execute(buildFourImageInput())).rejects.toThrow(
        'Upgrade to process more than 3 images'
      );
    });

    it('throws an ImageLimitError the client can detect by code', async () => {
      const useCase = new CreateImageOcclusionDeckUseCase();
      await expect(
        useCase.execute(buildFourImageInput())
      ).rejects.toMatchObject({
        name: 'ImageLimitError',
        status: 403,
        code: 'image_limit',
        limit: 3,
      });
    });

    it('rejects exactly 4 images for free users without touching the filesystem', async () => {
      const useCase = new CreateImageOcclusionDeckUseCase();
      await expect(useCase.execute(buildFourImageInput())).rejects.toThrow();
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('allows 3 images for free users (proceeds past the limit check)', async () => {
      const threeImages = Array.from({ length: 3 }, (_, i) => ({
        imageName: `img${i}.jpg`,
        header: '',
        rects: [{ x: 0, y: 0, w: 10, h: 10, label: '' }],
      }));
      const threeFiles = Array.from({ length: 3 }, (_, i) => ({
        name: `img${i}.jpg`,
        path: `/tmp/img${i}.jpg`,
      }));

      (mockFs.mkdirSync as Mock).mockImplementation(() => undefined);
      (mockFs.existsSync as Mock).mockReturnValue(false);
      (mockFs.copyFileSync as Mock).mockImplementation(() => undefined);
      (mockFs.writeFileSync as Mock).mockImplementation(() => undefined);
      (mockFs.rmSync as Mock).mockImplementation(() => undefined);

      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      (mockChild.spawn as Mock).mockReturnValue(mockProcess);

      const useCase = new CreateImageOcclusionDeckUseCase();
      const promise = useCase.execute(
        buildInput({
          images: threeImages,
          imageFiles: threeFiles,
          isPaying: false,
        })
      );

      const closeHandler = mockProcess.on.mock.calls.find(
        ([event]) => event === 'close'
      )?.[1];

      if (closeHandler) {
        const stdoutHandler = mockProcess.stdout.on.mock.calls.find(
          ([e]) => e === 'data'
        )?.[1];
        stdoutHandler?.('/tmp/deck.apkg');
        closeHandler(0);
      }

      await expect(promise).resolves.toBe('/tmp/deck.apkg');
    });

    it('allows unlimited images for paying users', async () => {
      const manyImages = Array.from({ length: 10 }, (_, i) => ({
        imageName: `img${i}.jpg`,
        header: '',
        rects: [{ x: 0, y: 0, w: 10, h: 10, label: '' }],
      }));
      const manyFiles = Array.from({ length: 10 }, (_, i) => ({
        name: `img${i}.jpg`,
        path: `/tmp/img${i}.jpg`,
      }));

      (mockFs.mkdirSync as Mock).mockImplementation(() => undefined);
      (mockFs.existsSync as Mock).mockReturnValue(false);
      (mockFs.copyFileSync as Mock).mockImplementation(() => undefined);
      (mockFs.writeFileSync as Mock).mockImplementation(() => undefined);
      (mockFs.rmSync as Mock).mockImplementation(() => undefined);

      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      (mockChild.spawn as Mock).mockReturnValue(mockProcess);

      const useCase = new CreateImageOcclusionDeckUseCase();
      const promise = useCase.execute(
        buildInput({
          images: manyImages,
          imageFiles: manyFiles,
          isPaying: true,
        })
      );

      const closeHandler = mockProcess.on.mock.calls.find(
        ([event]) => event === 'close'
      )?.[1];

      if (closeHandler) {
        const stdoutHandler = mockProcess.stdout.on.mock.calls.find(
          ([e]) => e === 'data'
        )?.[1];
        stdoutHandler?.('/tmp/deck.apkg');
        closeHandler(0);
      }

      await expect(promise).resolves.toBe('/tmp/deck.apkg');
    });
  });

  describe('draft images stored in S3', () => {
    const withKey = (s3Key: string, ownerId: number | null = 7) =>
      buildInput({
        ownerId,
        imageFiles: [],
        images: [
          {
            imageName: 'img1.jpg',
            header: '',
            rects: [{ x: 0, y: 0, w: 10, h: 10, label: '' }],
            s3Key,
          },
        ],
      });

    beforeEach(() => {
      mockGetFileContents.mockReset();
      (mockFs.mkdirSync as Mock).mockImplementation(() => undefined);
      (mockFs.existsSync as Mock).mockReturnValue(false);
      (mockFs.rmSync as Mock).mockImplementation(() => undefined);
    });

    it.each([
      ["another user's draft", 'io-drafts/8/a.jpg', 7],
      ['an upload outside the drafts folder', 'uploads/abc.apkg', 7],
      ['a path that climbs out of the folder', 'io-drafts/7/../8/a.jpg', 7],
      ['a signed-out caller', 'io-drafts/7/a.jpg', null],
    ])('refuses to read %s from the bucket', async (_label, key, ownerId) => {
      await expect(
        new CreateImageOcclusionDeckUseCase().execute(withKey(key, ownerId))
      ).rejects.toMatchObject({ status: 400, code: 'invalid_image_key' });
      expect(mockGetFileContents).not.toHaveBeenCalled();
    });

    it('answers 404 when the draft image is gone from the bucket', async () => {
      mockGetFileContents.mockRejectedValue(
        Object.assign(new Error('UnknownError'), { name: 'NoSuchKey' })
      );

      await expect(
        new CreateImageOcclusionDeckUseCase().execute(
          withKey('io-drafts/7/a.jpg')
        )
      ).rejects.toMatchObject({ status: 404, code: 'image_missing' });
      expect(mockGetFileContents).toHaveBeenCalledWith('io-drafts/7/a.jpg');
    });
  });
});
