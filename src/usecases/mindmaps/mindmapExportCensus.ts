import { MindmapData } from './MindmapData';
import type { MindmapCardType } from './ExportMindmapUseCase';
import { reachableNodeIds } from './mindmapGraph';

function realEdgeIncidentNodeIds(data: MindmapData): Set<string> {
  const nodeIds = new Set(data.nodes.map((n) => n.id));
  const incident = new Set<string>();
  for (const edge of data.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incident.add(edge.source);
    incident.add(edge.target);
  }
  return incident;
}

export function mediaEligibleNodeIds(
  data: MindmapData,
  cardType: MindmapCardType
): Set<string> {
  if (cardType === 'basic') {
    return realEdgeIncidentNodeIds(data);
  }
  return reachableNodeIds(data);
}

export function countExcludedMindmapNodes(
  data: MindmapData,
  cardType: MindmapCardType
): number {
  const eligible = mediaEligibleNodeIds(data, cardType);
  return data.nodes.filter((n) => !eligible.has(n.id)).length;
}
