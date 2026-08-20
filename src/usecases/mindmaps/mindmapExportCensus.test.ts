import { countExcludedMindmapNodes } from './mindmapExportCensus';

describe('countExcludedMindmapNodes', () => {
  const connectedTree = {
    nodes: [
      { id: '1', label: 'Root' },
      { id: '2', label: 'Child' },
    ],
    edges: [{ source: '1', target: '2' }],
  };

  const treeWithOrphan = {
    nodes: [
      { id: '1', label: 'Root' },
      { id: '2', label: 'Child' },
      { id: 'x', label: 'Orphan' },
    ],
    edges: [{ source: '1', target: '2' }],
  };

  const pureCycle = {
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ],
  };

  it('excludes nothing from a fully connected tree', () => {
    expect(countExcludedMindmapNodes(connectedTree, 'basic')).toBe(0);
    expect(countExcludedMindmapNodes(connectedTree, 'cloze')).toBe(0);
    expect(countExcludedMindmapNodes(connectedTree, 'markmap')).toBe(0);
  });

  it('counts an isolated node as excluded from a basic (per-edge) export', () => {
    expect(countExcludedMindmapNodes(treeWithOrphan, 'basic')).toBe(1);
  });

  it('does not exclude an isolated node from cloze or markmap exports', () => {
    expect(countExcludedMindmapNodes(treeWithOrphan, 'cloze')).toBe(0);
    expect(countExcludedMindmapNodes(treeWithOrphan, 'markmap')).toBe(0);
  });

  it('excludes rootless-cycle nodes from cloze and markmap but not basic', () => {
    expect(countExcludedMindmapNodes(pureCycle, 'cloze')).toBe(2);
    expect(countExcludedMindmapNodes(pureCycle, 'markmap')).toBe(2);
    expect(countExcludedMindmapNodes(pureCycle, 'basic')).toBe(0);
  });

  it('counts every node of an edge-free map as excluded for basic export', () => {
    const edgeFree = {
      nodes: [
        { id: '1', label: 'A' },
        { id: '2', label: 'B' },
      ],
      edges: [],
    };
    expect(countExcludedMindmapNodes(edgeFree, 'basic')).toBe(2);
    expect(countExcludedMindmapNodes(edgeFree, 'cloze')).toBe(0);
  });

  it('counts a node whose only edge dangles as excluded from basic export', () => {
    const danglingOnly = {
      nodes: [
        { id: '1', label: 'Root' },
        { id: '2', label: 'Child' },
        { id: 'lonely', label: 'Dangling-only' },
      ],
      edges: [
        { source: '1', target: '2' },
        { source: 'lonely', target: 'ghost' },
      ],
    };
    expect(countExcludedMindmapNodes(danglingOnly, 'basic')).toBe(1);
  });
});
