import { describe, expect, it } from 'vitest';

import { buildEmptyNoteType, duplicateStarter } from './buildNoteType';

describe('buildEmptyNoteType', () => {
  it('builds a Basic starter with Front and Back fields', () => {
    const starter = buildEmptyNoteType('basic');
    expect(starter.baseType).toBe('basic');
    expect(starter.noteType.type).toBe(0);
    expect(starter.noteType.flds.map((f) => f.name)).toEqual(['Front', 'Back']);
    expect(starter.noteType.tmpls).toHaveLength(1);
    expect(starter.noteType.tmpls[0].qfmt).toContain('{{Front}}');
    expect(starter.noteType.tmpls[0].afmt).toContain('{{Back}}');
    expect(starter.previewData.Front).toBeTruthy();
    expect(starter.previewData.Back).toBeTruthy();
  });

  it('builds a Cloze starter with Text and Extra fields', () => {
    const starter = buildEmptyNoteType('cloze');
    expect(starter.baseType).toBe('cloze');
    expect(starter.noteType.type).toBe(1);
    expect(starter.noteType.flds.map((f) => f.name)).toEqual(['Text', 'Extra']);
    expect(starter.noteType.tmpls[0].qfmt).toContain('{{cloze:Text}}');
  });

  it('assigns a fresh id every call', () => {
    const a = buildEmptyNoteType('basic');
    const b = buildEmptyNoteType('basic');
    expect(a.id).not.toBe(b.id);
  });
});

describe('duplicateStarter', () => {
  it('returns a structurally equal copy with a new id', () => {
    const original = buildEmptyNoteType('basic');
    const copy = duplicateStarter(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe(`${original.name} (copy)`);
    expect(copy.noteType.tmpls).toEqual(original.noteType.tmpls);
    expect(copy.noteType.flds).toEqual(original.noteType.flds);
    expect(copy.previewData).toEqual(original.previewData);
  });

  it('does not mutate the original when the copy is edited', () => {
    const original = buildEmptyNoteType('basic');
    const copy = duplicateStarter(original);
    copy.noteType.tmpls[0].qfmt = 'mutated';
    expect(original.noteType.tmpls[0].qfmt).not.toBe('mutated');
  });

  it('keeps a custom name when the draft was renamed from its source', () => {
    const original = buildEmptyNoteType('basic');
    const renamed = { ...original, name: 'Alex Super Clean Basic' };
    const copy = duplicateStarter(renamed, original.name);
    expect(copy.name).toBe('Alex Super Clean Basic');
  });

  it('appends (copy) when the draft name matches its source', () => {
    const original = buildEmptyNoteType('basic');
    const copy = duplicateStarter(original, original.name);
    expect(copy.name).toBe(`${original.name} (copy)`);
  });
});
