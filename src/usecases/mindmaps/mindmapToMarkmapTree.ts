import { MindmapData } from './MindmapData';
import { escapeHtml } from './escapeHtml';
import { buildChildMap, findRootIds } from './mindmapGraph';

export interface MarkmapTreeNode {
  content: string;
  children: MarkmapTreeNode[];
  payload?: { fold?: number };
}

function buildNodeContent(
  nodeId: string,
  labelMap: Map<string, string>,
  imageUrlMap: Map<string, string | undefined>,
  filenameMap: Record<string, string>
): string {
  const label = labelMap.get(nodeId) ?? nodeId;
  const imageUrl = imageUrlMap.get(nodeId);
  if (imageUrl == null) return escapeHtml(label);

  const filename = imageUrl.split('/').pop() ?? '';
  const mapped = filenameMap[filename];
  if (mapped == null) return escapeHtml(label);

  const imgTag = `<img src="${mapped}" alt="${escapeHtml(label)}" style="max-width:100%;height:auto;">`;
  return label.length > 0 ? `${imgTag}<br>${escapeHtml(label)}` : imgTag;
}

function buildTree(
  nodeId: string,
  labelMap: Map<string, string>,
  imageUrlMap: Map<string, string | undefined>,
  childMap: Map<string, string[]>,
  filenameMap: Record<string, string>,
  ancestors: Set<string>
): MarkmapTreeNode {
  const content = buildNodeContent(nodeId, labelMap, imageUrlMap, filenameMap);
  const childIds = (childMap.get(nodeId) ?? []).filter(
    (childId) => !ancestors.has(childId)
  );
  const nextAncestors = new Set(ancestors).add(nodeId);
  return {
    content,
    children: childIds.map((childId) =>
      buildTree(
        childId,
        labelMap,
        imageUrlMap,
        childMap,
        filenameMap,
        nextAncestors
      )
    ),
  };
}

export function mindmapToMarkmapTree(
  data: MindmapData,
  filenameMap: Record<string, string> = {}
): MarkmapTreeNode | null {
  if (data.nodes.length === 0) {
    return null;
  }

  const labelMap = new Map<string, string>(
    data.nodes.map((n) => [n.id, n.label])
  );
  const imageUrlMap = new Map<string, string | undefined>(
    data.nodes.map((n) => [n.id, n.image?.url ?? undefined])
  );
  const childMap = buildChildMap(data);
  const rootIds = findRootIds(data);

  const rootTrees = rootIds.map((rootId) =>
    buildTree(rootId, labelMap, imageUrlMap, childMap, filenameMap, new Set())
  );

  if (rootTrees.length === 1) {
    return rootTrees[0];
  }
  return { content: '', children: rootTrees };
}
