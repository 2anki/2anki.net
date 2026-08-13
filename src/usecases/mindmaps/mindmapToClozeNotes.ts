import Note from '../../lib/parser/Note';
import { markdownToInlineHTML } from '../../lib/markdown';
import { MindmapData } from './MindmapData';
import { buildChildMap, findRootIds } from './mindmapGraph';

function collectPaths(
  nodeId: string,
  childMap: Map<string, string[]>,
  currentPath: string[]
): string[][] {
  const path = [...currentPath, nodeId];
  const onPath = new Set(path);
  const children = (childMap.get(nodeId) ?? []).filter(
    (childId) => !onPath.has(childId)
  );
  if (children.length === 0) {
    return [path];
  }
  return children.flatMap((childId) => collectPaths(childId, childMap, path));
}

function nodeLabel(
  id: string,
  labelMap: Map<string, string>,
  imageUrlMap: Map<string, string | undefined>,
  filenameMap: Record<string, string>
): string {
  const label = labelMap.get(id) ?? id;
  const labelHtml = markdownToInlineHTML(label);
  const imageUrl = imageUrlMap.get(id);
  if (imageUrl == null) return labelHtml;
  const filename = imageUrl.split('/').pop() ?? '';
  const mapped = filenameMap[filename];
  if (mapped == null) return labelHtml;
  const labelSuffix = labelHtml.length > 0 ? `<br>${labelHtml}` : '';
  return `<img src="${mapped}" alt="${label}" style="max-width:100%;height:auto;">${labelSuffix}`;
}

export function mindmapToClozeNotes(
  data: MindmapData,
  filenameMap: Record<string, string> = {}
): Note[] {
  if (data.nodes.length === 0) {
    return [];
  }

  const labelMap = new Map<string, string>(
    data.nodes.map((n) => [n.id, n.label])
  );
  const imageUrlMap = new Map<string, string | undefined>(
    data.nodes.map((n) => [n.id, n.image?.url ?? undefined])
  );
  const childMap = buildChildMap(data);
  const roots = findRootIds(data);

  const allPaths = roots.flatMap((root) => collectPaths(root, childMap, []));

  return allPaths.map((path) => {
    const parts = path.map((id, index) => {
      const label = nodeLabel(id, labelMap, imageUrlMap, filenameMap);
      const isLeaf = index === path.length - 1;
      const clozed = !isLeaf || path.length === 1;
      return clozed ? `{{c${index + 1}::${label}}}` : label;
    });
    const note = new Note(parts.join(' → '), '');
    note.cloze = true;
    const media = path
      .map((id) => imageUrlMap.get(id))
      .map((url) =>
        url == null ? null : filenameMap[url.split('/').pop() ?? '']
      )
      .filter((m): m is string => m != null);
    if (media.length > 0) note.media = media;
    return note;
  });
}
