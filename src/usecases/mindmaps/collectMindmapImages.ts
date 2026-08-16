import StorageHandler from '../../lib/storage/StorageHandler';
import { MindmapData } from './MindmapData';

export interface CollectedImage {
  filename: string;
  buffer: Buffer;
}

export async function collectMindmapImages(
  data: MindmapData,
  storage: StorageHandler,
  eligibleNodeIds: Set<string> | null = null
): Promise<CollectedImage[]> {
  const seen = new Set<string>();
  const result: CollectedImage[] = [];

  for (const node of data.nodes) {
    if (eligibleNodeIds != null && !eligibleNodeIds.has(node.id)) continue;
    const { image } = node;
    if (image == null) continue;
    if (image.url == null || image.missing === true) continue;

    const s3Key = image.url;
    if (seen.has(s3Key)) continue;
    seen.add(s3Key);

    const filename = s3Key.split('/').pop() ?? '';

    try {
      const stored = await storage.getFileContents(s3Key);
      if (stored.Body == null) continue;
      result.push({ filename, buffer: stored.Body });
    } catch {
      continue;
    }
  }

  return result;
}
