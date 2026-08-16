process.env.SKIP_CREATE_DECK = '1';

import { ExportMindmapUseCase, MindmapCardType } from './ExportMindmapUseCase';
import { MindmapData } from './MindmapData';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import StorageHandler from '../../lib/storage/StorageHandler';
import { MindmapsId } from '../../data_layer/public/Mindmaps';
import { UsersId } from '../../data_layer/public/Users';

const mapWithIsolatedImageNode: MindmapData = {
  nodes: [
    {
      id: 'a',
      label: 'Heart',
      image: { url: 'mindmaps/2/1/heart.png', width: 10, height: 10 },
    },
    {
      id: 'b',
      label: 'Aorta',
      image: { url: 'mindmaps/2/1/aorta.png', width: 10, height: 10 },
    },
    {
      id: 'floating',
      label: 'Floating note',
      image: { url: 'mindmaps/2/1/floating.png', width: 10, height: 10 },
    },
  ],
  edges: [{ source: 'a', target: 'b' }],
};

function buildUseCase(data: MindmapData) {
  const repo = {
    findById: jest.fn().mockResolvedValue({ id: 1, title: 'Anatomy', data }),
  };
  const storage = {
    getFileContents: jest
      .fn()
      .mockResolvedValue({ Body: Buffer.from('png-bytes') }),
  };
  const useCase = new ExportMindmapUseCase(
    repo as unknown as MindmapRepositoryInterface,
    storage as unknown as StorageHandler
  );
  return { useCase, storage };
}

function runExport(data: MindmapData, cardType: MindmapCardType) {
  const { useCase, storage } = buildUseCase(data);
  return useCase
    .execute({ id: 'map-1' as MindmapsId, userId: 2 as UsersId, cardType })
    .then((result) => ({ result, storage }));
}

describe('ExportMindmapUseCase media bundling', () => {
  it('does not fetch or bundle an isolated node image on basic export', async () => {
    const { result, storage } = await runExport(
      mapWithIsolatedImageNode,
      'basic'
    );
    const fetchedKeys = storage.getFileContents.mock.calls.map((c) => c[0]);
    expect(fetchedKeys).toContain('mindmaps/2/1/heart.png');
    expect(fetchedKeys).toContain('mindmaps/2/1/aorta.png');
    expect(fetchedKeys).not.toContain('mindmaps/2/1/floating.png');
    expect(result.buffer.toString()).not.toContain('floating.png');
    expect(result.excludedNodeCount).toBe(1);
  });

  it('still fetches the isolated node image on cloze export, where it becomes a card', async () => {
    const { result, storage } = await runExport(
      mapWithIsolatedImageNode,
      'cloze'
    );
    const fetchedKeys = storage.getFileContents.mock.calls.map((c) => c[0]);
    expect(fetchedKeys).toContain('mindmaps/2/1/floating.png');
    expect(result.buffer.toString()).toContain('floating.png');
  });

  it('fetches every node image on markmap export', async () => {
    const { storage } = await runExport(mapWithIsolatedImageNode, 'markmap');
    expect(storage.getFileContents).toHaveBeenCalledTimes(3);
  });

  it('keeps connected-node media intact on basic export', async () => {
    const { result } = await runExport(mapWithIsolatedImageNode, 'basic');
    const payload = result.buffer.toString();
    expect(payload).toContain('heart.png');
    expect(payload).toContain('aorta.png');
  });
});
