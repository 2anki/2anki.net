import baseline from './__fixtures__/starters-baseline.json';
import {
  Starter,
  getBasicReversedNoteType,
  getHierarchyNoteType,
  getInputNoteType,
  getStarters,
  listConversionStarters,
  listEditorStarters,
} from './starters';
import { validateTemplateFields } from '../lib/templates/validateTemplateFields';

function publicShape(starters: Starter[]) {
  return starters.map((starter) => {
    const copy = JSON.parse(JSON.stringify(starter));
    delete copy.surface;
    if (copy.noteType && typeof copy.noteType.id === 'number') {
      delete copy.noteType.id;
    }
    return copy;
  });
}

describe('getStarters consolidation', () => {
  it('keeps the official endpoint id set byte-identical to main', () => {
    expect(publicShape(listConversionStarters())).toEqual(baseline.official);
  });

  it('keeps the defaults endpoint id set byte-identical to main', () => {
    expect(publicShape(listEditorStarters())).toEqual(baseline.defaults);
  });

  it('keeps the official id list and order stable', () => {
    expect(listConversionStarters().map((s) => s.id)).toEqual(
      baseline.official.map((s: { id: string }) => s.id)
    );
  });

  it('keeps the defaults id list and order stable', () => {
    expect(listEditorStarters().map((s) => s.id)).toEqual(
      baseline.defaults.map((s: { id: string }) => s.id)
    );
  });

  it('exposes both surfaces as one list with no duplicate ids', () => {
    const ids = getStarters().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(
      baseline.official.length + baseline.defaults.length
    );
  });

  it('tags every starter with a known surface', () => {
    for (const starter of getStarters()) {
      expect(['editor', 'conversion', 'both']).toContain(starter.surface);
    }
  });

  it('only references fields that exist on every starter note type', () => {
    const failures: string[] = [];
    for (const starter of getStarters()) {
      const result = validateTemplateFields(starter.noteType);
      if (!result.ok) {
        failures.push(`${starter.id}: ${result.message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('shapes every starter as a note-type starter', () => {
    for (const starter of getStarters()) {
      expect(starter).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        description: expect.any(String),
        baseType: expect.any(String),
        noteType: {
          name: expect.any(String),
          tmpls: expect.any(Array),
          flds: expect.any(Array),
          css: expect.any(String),
        },
        previewData: expect.any(Object),
        tags: expect.any(Array),
      });
      expect(starter.noteType.tmpls.length).toBeGreaterThan(0);
      expect(starter.noteType.flds.length).toBeGreaterThan(0);
    }
  });
});

function findStarter(id: string): Starter {
  const starter = getStarters().find((s) => s.id === id);
  if (!starter) throw new Error(`missing starter ${id}`);
  return starter;
}

describe('conversion starters', () => {
  it('wires the Material basic template with its files', () => {
    const material = findStarter('official-material-basic');
    expect(material.noteType.tmpls[0].qfmt).toContain('{{Front}}');
    expect(material.noteType.css).toContain('.md-card');
  });

  it('wires the Material cloze template with its highlight styling', () => {
    const material = findStarter('official-material-cloze');
    expect(material.noteType.type).toBe(1);
    expect(material.noteType.tmpls[0].qfmt).toContain('{{cloze:Text}}');
    expect(material.noteType.css).toContain('.cloze');
  });

  it('marks the cloze and image-occlusion starters as cloze type', () => {
    expect(findStarter('official-n2a-cloze').noteType.type).toBe(1);
    expect(findStarter('official-n2a-io').noteType.type).toBe(1);
  });

  it('names the image-occlusion note type distinctly from Anki stock', () => {
    expect(findStarter('official-n2a-io').noteType.name).toBe(
      '2anki Image Occlusion'
    );
  });

  it('keeps the Anki template HTML in qfmt/afmt', () => {
    const basic = findStarter('official-n2a-basic');
    expect(basic.noteType.tmpls[0].qfmt).toContain('{{Front}}');
    expect(basic.noteType.tmpls[0].afmt).toContain('{{Back}}');
  });

  it('returns the Raw Note variant with an empty CSS string', () => {
    expect(findStarter('official-no-style-basic').noteType.css).toBe('');
  });

  it('exposes an Image field on Abhiyan basic and references it', () => {
    const abhiyanBasic = findStarter('official-abhiyan-basic');
    expect(abhiyanBasic.noteType.flds.map((f) => f.name)).toContain('Image');
    expect(abhiyanBasic.noteType.tmpls[0].qfmt).toContain('{{#Image}}');
    expect(abhiyanBasic.noteType.tmpls[0].qfmt).toContain('{{Image}}');
    expect(abhiyanBasic.previewData).toHaveProperty('Image');
  });

  it('exposes an Image field on Abhiyan cloze and references it', () => {
    const abhiyanCloze = findStarter('official-abhiyan-cloze');
    expect(abhiyanCloze.noteType.flds.map((f) => f.name)).toContain('Image');
    expect(abhiyanCloze.noteType.tmpls[0].qfmt).toContain('{{#Image}}');
    expect(abhiyanCloze.noteType.tmpls[0].afmt).toContain('{{#Image}}');
    expect(abhiyanCloze.previewData).toHaveProperty('Image');
  });
});

describe('editor starters', () => {
  it('surfaces the Basic Reversed, Type the answer, and Hierarchy starters', () => {
    const ids = listEditorStarters().map((s) => s.id);
    expect(ids).toContain('basic-reversed');
    expect(ids).toContain('input-type-the-answer');
    expect(ids).toContain('hierarchy');
  });
});

describe('getBasicReversedNoteType', () => {
  const noteType = getBasicReversedNoteType();

  it('generates two card templates from the same Front + Back fields', () => {
    expect(noteType.tmpls).toHaveLength(2);
    expect(noteType.tmpls[0].qfmt).toContain('{{Front}}');
    expect(noteType.tmpls[0].afmt).toContain('{{Back}}');
    expect(noteType.tmpls[1].qfmt).toContain('{{Back}}');
    expect(noteType.tmpls[1].afmt).toContain('{{Front}}');
  });

  it('declares exactly the Front and Back fields', () => {
    expect(noteType.flds.map((f) => f.name)).toEqual(['Front', 'Back']);
  });
});

describe('getInputNoteType', () => {
  const noteType = getInputNoteType();

  it('uses {{type:Back}} on the front so Anki diffs the typed answer', () => {
    expect(noteType.tmpls[0].qfmt).toContain('{{type:Back}}');
    expect(noteType.tmpls[0].afmt).toContain('{{type:Back}}');
  });

  it('declares Front and Back fields only', () => {
    expect(noteType.flds.map((f) => f.name)).toEqual(['Front', 'Back']);
  });
});

describe('getHierarchyNoteType', () => {
  const noteType = getHierarchyNoteType();

  it('declares H1, H2, H3, Question, and Answer fields in order', () => {
    expect(noteType.flds.map((f) => f.name)).toEqual([
      'H1',
      'H2',
      'H3',
      'Question',
      'Answer',
    ]);
  });

  it('shows the breadcrumb and Question on the front, without the Answer', () => {
    const qfmt = noteType.tmpls[0].qfmt;
    expect(qfmt).toContain('{{#H1}}');
    expect(qfmt).toContain('{{#H2}}');
    expect(qfmt).toContain('{{#H3}}');
    expect(qfmt).toContain('{{Question}}');
    expect(qfmt).not.toContain('{{Answer}}');
  });

  it('adds the Answer on the back', () => {
    const afmt = noteType.tmpls[0].afmt;
    expect(afmt).toContain('{{Question}}');
    expect(afmt).toContain('{{Answer}}');
  });
});
