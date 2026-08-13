import { MindmapData } from './MindmapData';

export function buildChildMap(data: MindmapData): Map<string, string[]> {
  const childMap = new Map<string, string[]>();
  for (const node of data.nodes) {
    childMap.set(node.id, []);
  }
  for (const edge of data.edges) {
    const children = childMap.get(edge.source);
    if (children != null) {
      children.push(edge.target);
    }
  }
  return childMap;
}

export function findRootIds(data: MindmapData): string[] {
  const hasParent = new Set(data.edges.map((e) => e.target));
  return data.nodes.map((n) => n.id).filter((id) => !hasParent.has(id));
}

export function reachableNodeIds(data: MindmapData): Set<string> {
  const childMap = buildChildMap(data);
  const reachable = new Set<string>();
  const stack = [...findRootIds(data)];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const child of childMap.get(id) ?? []) {
      if (!reachable.has(child)) stack.push(child);
    }
  }
  return reachable;
}
