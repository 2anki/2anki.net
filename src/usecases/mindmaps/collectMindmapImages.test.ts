import { vi, type Mock } from 'vitest';
import { collectMindmapImages } from './collectMindmapImages';
import { MindmapData } from './MindmapData';
import StorageHandler from '../../lib/storage/StorageHandler';

function makeStorage(files: Record<string, Buffer> = {}): StorageHandler {
  return {
    getFileContents: vi.fn().mockImplementation(async (key: string) => {
      const body = files[key];
      return { Body: body };
    }),
    uploadFile: vi.fn(),
    getPresignedUrl: vi.fn(),
    objectExists: vi.fn(),
    listByPrefix: vi.fn(),
    deleteObjects: vi.fn(),
    delete: vi.fn(),
    getContents: vi.fn(),
    uniqify: vi.fn(),
    s3: {} as never,
  } as unknown as StorageHandler;
}

function nodeWithImage(id: string, url: string) {
  return { id, label: '', image: { url, width: 10, height: 10 } };
}

describe('collectMindmapImages', () => {
  it('returns an empty array when no nodes have images', async () => {
    const data: MindmapData = {
      nodes: [{ id: 'a', label: 'plain' }],
      edges: [],
    };
    const result = await collectMindmapImages(data, makeStorage());
    expect(result).toEqual([]);
  });

  it('fetches each referenced s3Key and returns buffer with filename', async () => {
    const fakePng = Buffer.from('fake-png');
    const storage = makeStorage({ 'mindmaps/1/map-1/foo.png': fakePng });
    const data: MindmapData = {
      nodes: [nodeWithImage('a', 'mindmaps/1/map-1/foo.png')],
      edges: [],
    };

    const result = await collectMindmapImages(data, storage);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('foo.png');
    expect(result[0].buffer).toEqual(fakePng);
  });

  it('deduplicates nodes that share the same s3 key', async () => {
    const fakePng = Buffer.from('fake-png');
    const storage = makeStorage({ 'mindmaps/1/map-1/foo.png': fakePng });
    const url = 'mindmaps/1/map-1/foo.png';
    const data: MindmapData = {
      nodes: [nodeWithImage('a', url), nodeWithImage('b', url)],
      edges: [],
    };

    const result = await collectMindmapImages(data, storage);
    expect(result).toHaveLength(1);
  });

  it('skips missing images (url null or missing flag)', async () => {
    const data: MindmapData = {
      nodes: [
        {
          id: 'a',
          label: '',
          image: { url: null, width: 10, height: 10, missing: true },
        },
      ],
      edges: [],
    };

    const result = await collectMindmapImages(data, makeStorage());
    expect(result).toEqual([]);
  });

  it('skips images where S3 returns no body', async () => {
    const storage = makeStorage({});
    const data: MindmapData = {
      nodes: [nodeWithImage('a', 'mindmaps/1/map-1/missing.png')],
      edges: [],
    };

    const result = await collectMindmapImages(data, storage);
    expect(result).toEqual([]);
  });

  it('skips images where getFileContents throws', async () => {
    const storage = makeStorage();
    (storage.getFileContents as Mock).mockRejectedValue(new Error('S3 down'));
    const data: MindmapData = {
      nodes: [nodeWithImage('a', 'mindmaps/1/map-1/img.png')],
      edges: [],
    };

    const result = await collectMindmapImages(data, storage);
    expect(result).toEqual([]);
  });
});
