import {
  CreateImageOcclusionDeckUseCase,
  CreateImageOcclusionDeckInput,
} from './CreateImageOcclusionDeckUseCase';

jest.mock('node:fs');
jest.mock('node:child_process');

const mockFs = jest.requireMock('node:fs') as typeof import('node:fs');
const mockChild = jest.requireMock(
  'node:child_process'
) as typeof import('node:child_process');

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

      (mockFs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      (mockFs.copyFileSync as jest.Mock).mockImplementation(() => undefined);
      (mockFs.writeFileSync as jest.Mock).mockImplementation(() => undefined);
      (mockFs.rmSync as jest.Mock).mockImplementation(() => undefined);

      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      (mockChild.spawn as jest.Mock).mockReturnValue(mockProcess);

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

      (mockFs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      (mockFs.copyFileSync as jest.Mock).mockImplementation(() => undefined);
      (mockFs.writeFileSync as jest.Mock).mockImplementation(() => undefined);
      (mockFs.rmSync as jest.Mock).mockImplementation(() => undefined);

      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      (mockChild.spawn as jest.Mock).mockReturnValue(mockProcess);

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
});
