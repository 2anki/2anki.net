import { mindmapToClozeNotes } from './mindmapToClozeNotes';

describe('mindmapToClozeNotes', () => {
  it('returns empty array for empty graph', () => {
    const result = mindmapToClozeNotes({ nodes: [], edges: [] });
    expect(result).toEqual([]);
  });

  it('exports each node of an edge-free map as a single-node cloze card', () => {
    const result = mindmapToClozeNotes({
      nodes: [
        { id: '1', label: 'Root' },
        { id: '2', label: 'Isolated' },
      ],
      edges: [],
    });
    expect(result).toHaveLength(2);
    for (const note of result) {
      expect(note.cloze).toBe(true);
      expect(note.hasClozeDeletion()).toBe(true);
    }
    expect(result.map((n) => n.name)).toEqual(
      expect.arrayContaining(['{{c1::Root}}', '{{c1::Isolated}}'])
    );
  });

  it('keeps an isolated node alongside a connected tree as a single-node card', () => {
    const result = mindmapToClozeNotes({
      nodes: [
        { id: '1', label: 'Root' },
        { id: '2', label: 'Child' },
        { id: 'x', label: 'Orphan' },
      ],
      edges: [{ source: '1', target: '2' }],
    });
    expect(result).toHaveLength(2);
    const names = result.map((n) => n.name);
    expect(names).toEqual(
      expect.arrayContaining(['{{c1::Root}} → Child', '{{c1::Orphan}}'])
    );
  });

  it('exports a single isolated node as one single-node cloze card', () => {
    const result = mindmapToClozeNotes({
      nodes: [{ id: '1', label: 'Solo' }],
      edges: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('{{c1::Solo}}');
    expect(result[0].cloze).toBe(true);
  });

  it('terminates on a cycle reachable from a root without infinite recursion', () => {
    const result = mindmapToClozeNotes({
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
    expect(result).toHaveLength(1);
    expect(result[0].name).toContain('{{c1::Root}}');
    expect(result[0].name).toContain('{{c2::A}}');
    expect(result[0].name).toContain('B');
  });

  it('drops a rootless pure cycle without hanging', () => {
    const result = mindmapToClozeNotes({
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    });
    expect(result).toEqual([]);
  });

  it('produces one cloze note for a single linear path root → A → B', () => {
    const result = mindmapToClozeNotes({
      nodes: [
        { id: '1', label: 'Root' },
        { id: '2', label: 'A' },
        { id: '3', label: 'B' },
      ],
      edges: [
        { source: '1', target: '2' },
        { source: '2', target: '3' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].cloze).toBe(true);
    expect(result[0].name).toContain('{{c1::Root}}');
    expect(result[0].name).toContain('{{c2::A}}');
    expect(result[0].name).toContain('B');
  });

  it('produces one cloze note per leaf for a star graph (root → A, root → B)', () => {
    const result = mindmapToClozeNotes({
      nodes: [
        { id: 'root', label: 'Anatomy' },
        { id: 'a', label: 'Bone' },
        { id: 'b', label: 'Muscle' },
      ],
      edges: [
        { source: 'root', target: 'a' },
        { source: 'root', target: 'b' },
      ],
    });
    expect(result).toHaveLength(2);
    for (const note of result) {
      expect(note.cloze).toBe(true);
      expect(note.name).toContain('{{c1::Anatomy}}');
    }
    const names = result.map((n) => n.name);
    expect(names.some((n) => n.includes('Bone'))).toBe(true);
    expect(names.some((n) => n.includes('Muscle'))).toBe(true);
  });

  it('clozifies every node except the leaf for a deep tree', () => {
    const result = mindmapToClozeNotes({
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
    expect(result).toHaveLength(1);
    expect(result[0].cloze).toBe(true);
    expect(result[0].name).toContain('{{c1::Science}}');
    expect(result[0].name).toContain('{{c2::Biology}}');
    expect(result[0].name).toContain('{{c3::Genetics}}');
    expect(result[0].name).toContain('DNA');
    expect(result[0].name).not.toContain('{{c4::DNA}}');
  });

  it('produces valid cloze notes', () => {
    const result = mindmapToClozeNotes({
      nodes: [
        { id: '1', label: 'Q' },
        { id: '2', label: 'A' },
      ],
      edges: [{ source: '1', target: '2' }],
    });
    expect(result[0].isValidClozeNote()).toBeTruthy();
  });

  it('renders markdown in node labels as HTML inside cloze deletions', () => {
    const result = mindmapToClozeNotes({
      nodes: [
        { id: '1', label: '**Cell**' },
        { id: '2', label: '*Nucleus*' },
      ],
      edges: [{ source: '1', target: '2' }],
    });
    expect(result[0].name).toContain('{{c1::<strong>Cell</strong>}}');
    expect(result[0].name).not.toContain('**Cell**');
    expect(result[0].name).toContain('<em>Nucleus</em>');
  });

  it('handles a branching tree: root → A → C, root → B', () => {
    const result = mindmapToClozeNotes({
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
    expect(result).toHaveLength(2);
    const names = result.map((n) => n.name);
    expect(names.some((n) => n.includes('C'))).toBe(true);
    expect(names.some((n) => n.includes('B'))).toBe(true);
  });
});
