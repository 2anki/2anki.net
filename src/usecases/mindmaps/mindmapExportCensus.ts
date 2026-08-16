import { MindmapData } from './MindmapData';
import type { MindmapCardType } from './ExportMindmapUseCase';
import { reachableNodeIds } from './mindmapGraph';

function edgeIncidentNodeIds(data: MindmapData): Set<string> {
  const incident = new Set<string>();
  for (const edge of data.edges) {
    incident.add(edge.source);
    incident.add(edge.target);
  }
  return incident;
}

function countIsolatedNodes(data: MindmapData): number {
  const incident = edgeIncidentNodeIds(data);
  return data.nodes.filter((n) => !incident.has(n.id)).length;
}

export function mediaEligibleNodeIds(
  data: MindmapData,
  cardType: MindmapCardType
): Set<string> | null {
  if (cardType === 'basic') {
    return edgeIncidentNodeIds(data);
  }
  if (cardType === 'cloze') {
    return reachableNodeIds(data);
  }
  return null;
}

export function countExcludedMindmapNodes(
  data: MindmapData,
  cardType: MindmapCardType
): number {
  if (cardType === 'basic') {
    return countIsolatedNodes(data);
  }
  const reachable = reachableNodeIds(data);
  return data.nodes.filter((n) => !reachable.has(n.id)).length;
}
