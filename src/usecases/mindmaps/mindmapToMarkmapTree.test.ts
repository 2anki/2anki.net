import { mindmapToMarkmapTree } from './mindmapToMarkmapTree';

describe('mindmapToMarkmapTree', () => {
  it('returns null for an empty graph', () => {
    expect(mindmapToMarkmapTree({ nodes: [], edges: [] })).toBeNull();
  });

  it('returns null when there are nodes but no edges and only one node', () => {
    const result = mindmapToMarkmapTree({
      nodes: [{ id: '1', label: 'Solo' }],
      edges: [],
    });
    expect(result).not.toBeNull();
    expect(result?.content).toBe('Solo');
    expect(result?.children).toHaveLength(0);
  });

  it('returns a tree with a root and one child', () => {
    const result = mindmapToMarkmapTree({
      nodes: [
        { id: '1', label: 'Root' },
        { id: '2', label: 'Child' },
      ],
      edges: [{ source: '1', target: '2' }],
    });
    expect(result).not.toBeNull();
    expect(result?.content).toBe('Root');
    expect(result?.children).toHaveLength(1);
    expect(result?.children[0].content).toBe('Child');
    expect(result?.children[0].children).toHaveLength(0);
  });

  it('builds a deep tree: root → A → B → C', () => {
    const result = mindmapToMarkmapTree({
      nodes: [
        { id: '1', label: 'Science' },
        { id: '2', label: 'Biology' },
        { id: '3', label: 'Genetics' },
        { id: '4', label: 'DNA' },
      ],
      edges: [
        { source: '1', target: '2' },
        { source: '2', target: '3' },
        { source: '3', target: '4' },
      ],
    });
    expect(result?.content).toBe('Science');
    expect(result?.children[0].content).toBe('Biology');
    expect(result?.children[0].children[0].content).toBe('Genetics');
    expect(result?.children[0].children[0].children[0].content).toBe('DNA');
  });

  it('builds a star tree: root with 3 children', () => {
    const result = mindmapToMarkmapTree({
      nodes: [
        { id: 'r', label: 'Anatomy' },
        { id: 'a', label: 'Bone' },
        { id: 'b', label: 'Muscle' },
        { id: 'c', label: 'Nerve' },
      ],
      edges: [
        { source: 'r', target: 'a' },
        { source: 'r', target: 'b' },
        { source: 'r', target: 'c' },
      ],
    });
    expect(result?.content).toBe('Anatomy');
    expect(result?.children).toHaveLength(3);
    const labels = result?.children.map((c) => c.content);
    expect(labels).toContain('Bone');
    expect(labels).toContain('Muscle');
    expect(labels).toContain('Nerve');
  });

  it('builds a branching tree: root → A → C, root → B', () => {
    const result = mindmapToMarkmapTree({
      nodes: [
        { id: 'r', label: 'Root' },
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      edges: [
        { source: 'r', target: 'a' },
        { source: 'r', target: 'b' },
        { source: 'a', target: 'c' },
      ],
    });
    expect(result?.content).toBe('Root');
    expect(result?.children).toHaveLength(2);
    const aNode = result?.children.find((c) => c.content === 'A');
    expect(aNode?.children[0].content).toBe('C');
    const bNode = result?.children.find((c) => c.content === 'B');
    expect(bNode?.children).toHaveLength(0);
  });

  it('renders a forest for multiple disconnected nodes with no edges', () => {
    const result = mindmapToMarkmapTree({
      nodes: [
        { id: '1', label: 'Isolated A' },
        { id: '2', label: 'Isolated B' },
      ],
      edges: [],
    });
    expect(result).not.toBeNull();
    expect(result?.children).toHaveLength(2);
    const labels = result?.children.map((c) => c.content);
    expect(labels).toContain('Isolated A');
    expect(labels).toContain('Isolated B');
  });

  it('renders a forest for two disconnected clusters, each with edges', () => {
    const result = mindmapToMarkmapTree({
      nodes: [
        { id: 'r1', label: 'Cluster1' },
        { id: 'c1', label: 'Leaf1' },
        { id: 'r2', label: 'Cluster2' },
        { id: 'c2', label: 'Leaf2' },
      ],
      edges: [
        { source: 'r1', target: 'c1' },
        { source: 'r2', target: 'c2' },
      ],
    });
    expect(result?.children).toHaveLength(2);
    const roots = result?.children.map((c) => c.content);
    expect(roots).toContain('Cluster1');
    expect(roots).toContain('Cluster2');
  });

  it('terminates on a cycle reachable from a root without infinite recursion', () => {
    const result = mindmapToMarkmapTree({
      nodes: [
        { id: 'r', label: 'Root' },
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [
        { source: 'r', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    });
    expect(result?.content).toBe('Root');
    expect(result?.children[0].content).toBe('A');
    expect(result?.children[0].children[0].content).toBe('B');
  });

  it('escapes HTML special characters in labels', () => {
    const result = mindmapToMarkmapTree({
      nodes: [{ id: '1', label: '<script>alert(1)</script>' }],
      edges: [],
    });
    expect(result?.content).not.toContain('<script>');
    expect(result?.content).toContain('&lt;');
  });
});
