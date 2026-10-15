import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { vi, type Mocked } from 'vitest';

import ApkgPreviewService from '../../services/ApkgPreviewService/ApkgPreviewService';
import PdfRenderService from '../../services/PdfRenderService';
import ExportApkgToPdfUseCase from './ExportApkgToPdfUseCase';

// A cloze note type shaped like the heavily-scripted ones popular in medical
// decks: the visible cloze sits behind an add-on filter
// (`{{edit:cloze:Text}}`) while a plain copy is hidden by CSS, the back puts
// the revealed text BEFORE its <hr>, and scripts drive buttons, a popup
// (hidden by a template <style> block) and a fixed-position logo. Written for
// this test; no third-party template text.
const FRONT = `<div class="plain-copy">{{cloze:Text}}</div>
<div class="edit-copy">{{edit:cloze:Text}}</div>
<script>startTimer();</script>
<a href="https://example.com"><img src="_brand.png" id="brand-logo"></a>`;

const BACK = `<div class="plain-copy">{{cloze:Text}}</div>
<div class="edit-copy">{{edit:cloze:Text}}</div>
<hr>
<button class="reveal-btn" onclick="revealNext()">Reveal Next</button>
{{#Notes}}<button class="hint-btn" onclick="toggle('notes')"><img src="_brand.png"> Notes</button>
<div id="notes" style="display: none;">{{edit:Notes}}</div>{{/Notes}}
{{#Extra}}<div id="extra">{{edit:Extra}}</div>{{/Extra}}
<div id="popup"><button onclick="closePopup()">&times;</button><a href="">&#8618;</a></div>
<style>#popup { display: none; }</style>
<script>setupPopup();</script>
<img src="missing.png" onerror="fetch('http://169.254.169.254/')">`;

const CSS = `html { display: flex; flex-direction: column; }
table td { background-color: #ddecf2; }
.plain-copy { display: none; }
.edit-copy { display: block; }
#brand-logo { position: fixed; bottom: 10px; right: 10px; }
.x {}</sty</style>le><script>alert('css')</script>`;

const FIELDS = ['Text', 'Extra', 'Notes'];

function buildScriptedClozeApkg(): Promise<Buffer> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE col (id INTEGER PRIMARY KEY, models TEXT, decks TEXT);
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, tags TEXT, flds TEXT
    );
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER
    );
  `);
  const models = {
    '1': {
      id: 1,
      name: 'Scripted Cloze',
      type: 1,
      css: CSS,
      flds: FIELDS.map((name, ord) => ({ name, ord })),
      tmpls: [{ name: 'Cloze', ord: 0, qfmt: FRONT, afmt: BACK }],
    },
  };
  db.prepare('INSERT INTO col (id, models, decks) VALUES (1, ?, ?)').run(
    JSON.stringify(models),
    JSON.stringify({ '2': { id: 2, name: 'Cardiology' } })
  );
  const fields = [
    'The {{c1::sinoatrial node}} paces the heart from the {{c2::right atrium}}',
    'Pacemaker cells depolarise on their own',
    'Lecture recap for the hint<script>alert("field")</script><img src="x.png" onerror="alert(1)">',
  ];
  db.prepare(
    "INSERT INTO notes (id, guid, mid, tags, flds) VALUES (10, 'g', 1, '', ?)"
  ).run(fields.join('\x1f'));
  db.prepare('INSERT INTO cards VALUES (100, 10, 2, 0)').run();
  db.prepare('INSERT INTO cards VALUES (101, 10, 2, 1)').run();

  const zip = new JSZip();
  zip.file('collection.anki2', Buffer.from(db.serialize()));
  db.close();
  zip.file('media', JSON.stringify({}));
  return zip.generateAsync({ type: 'nodebuffer' });
}

function cardCells(html: string): string[] {
  return Array.from(
    html.matchAll(/<div class="card-content[^"]*">([\s\S]*?)<\/div><\/td>/g),
    (match) => match[1]
  );
}

describe('ExportApkgToPdfUseCase — scripted cloze templates', () => {
  let pdfRenderService: Mocked<PdfRenderService>;
  let html: string;

  beforeEach(async () => {
    pdfRenderService = {
      renderDocument: vi.fn().mockResolvedValue(Buffer.from('%PDF-')),
    } as unknown as Mocked<PdfRenderService>;
    const useCase = new ExportApkgToPdfUseCase(
      new ApkgPreviewService(),
      pdfRenderService
    );
    await useCase.execute(await buildScriptedClozeApkg(), true);
    html = pdfRenderService.renderDocument.mock.calls[0][0].html;
  });

  it('prints the cloze text behind an add-on filter on the front', () => {
    const [front] = cardCells(html);
    expect(front).toContain(
      '<div class="edit-copy">The <span class="cloze">[…]</span> paces the heart from the right atrium</div>'
    );
  });

  it('prints the revealed text that the back places before its <hr>', () => {
    const [, back] = cardCells(html);
    expect(back).toContain(
      '<div class="edit-copy">The <span class="cloze">sinoatrial node</span> paces the heart from the right atrium</div>'
    );
    expect(back).toContain('Pacemaker cells depolarise on their own');
  });

  it('drops interactive buttons and their labels', () => {
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Reveal Next');
    expect(html).not.toContain('×');
  });

  it('keeps element ids and template <style> rules so the deck hides its own popup', () => {
    expect(html).toContain('<div id="popup">');
    expect(html).toContain('#popup { display: none; }');
  });

  it('confines the note CSS to its cards with @scope, once per note type', () => {
    expect(html).not.toContain('<style scoped>');
    const scoped = html.match(/@scope \(\.deck-css-0\) \{/g) ?? [];
    expect(scoped).toHaveLength(1);
    expect(html.match(/html \{ display: flex/g) ?? []).toHaveLength(1);
  });

  it('hides fixed-position overlays before printing', () => {
    expect(html).toContain("getComputedStyle(nodes[i]).position === 'fixed'");
  });

  it('drops <script> and on* handlers from fields and templates', () => {
    expect(html).not.toContain('alert("field")');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toMatch(/<script[^>]*>\s*alert/);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('setupPopup');
    expect(html).not.toContain('169.254.169.254');
  });

  it('lets note CSS no way out of its <style> element', () => {
    const styleCloses = html.match(/<\/style>/g) ?? [];
    const styleOpens = html.match(/<style\b/g) ?? [];
    expect(styleCloses).toHaveLength(styleOpens.length);
  });

  it('only runs scripts that carry the render nonce', () => {
    const csp = html.match(/script-src 'nonce-([^']+)'/);
    expect(csp).not.toBeNull();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${csp?.[1]}"`);
    }
  });
});
