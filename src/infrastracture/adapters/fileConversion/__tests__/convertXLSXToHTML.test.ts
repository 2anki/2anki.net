import { readFileSync } from 'fs';
import Workspace from '../../../../lib/parser/WorkSpace';
import { convertXLSXToHTML } from '../convertXLSXToHTML';
import { looksLikeHeaderRow } from '../tabularRows';
import { join } from 'path';
import * as XLSX from 'xlsx';

describe('convertXLSXToHTML', () => {
  beforeAll(() => {
    process.env.WORKSPACE_BASE = '/tmp';
  });

  it('should convert XLSX to HTML and save the file', async () => {
    const workspace = new Workspace(true, 'fs');
    const xlsxPath = join(__dirname, '../___mock/sim.xlsx');
    const buffer = readFileSync(xlsxPath);
    const html = convertXLSXToHTML(
      buffer,
      join(workspace.location, 'Simple.html')
    );
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Simple.html');
  });

  afterAll(() => {
    delete process.env.WORKSPACE_BASE;
  });
});

function buildXlsxBuffer(rows: unknown[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('looksLikeHeaderRow', () => {
  it('treats a row of short non-numeric strings as a header', () => {
    expect(looksLikeHeaderRow(['Term', 'Definition'] as never)).toBe(true);
  });

  it('treats a row with a numeric cell as data, not a header', () => {
    expect(looksLikeHeaderRow(['Term', 42] as never)).toBe(false);
  });

  it('keeps a row with leading short labels but a long-form back cell as data', () => {
    const longBack =
      'A really long answer that runs well past the heuristic length cap used to spot label-shaped rows';
    expect(looksLikeHeaderRow(['hello', longBack] as never)).toBe(false);
  });
});

describe('convertXLSXToHTML header detection', () => {
  it('skips a header row when row 0 looks like labels', () => {
    const buffer = buildXlsxBuffer([
      ['Term', 'Definition'],
      ['hola', 'hello'],
      ['adiós', 'goodbye'],
    ]);
    const html = convertXLSXToHTML(buffer, 'deck.html');
    expect(html).not.toContain('<summary>Term</summary>');
    expect(html).toContain('<summary>hola</summary>');
    expect(html).toContain('<summary>adiós</summary>');
  });

  it('keeps row 0 when it contains a numeric cell', () => {
    const buffer = buildXlsxBuffer([
      ['question 1', 2024],
      ['question 2', 2025],
    ]);
    const html = convertXLSXToHTML(buffer, 'deck.html');
    expect(html).toContain('<summary>question 1</summary>');
    expect(html).toContain('<summary>question 2</summary>');
  });

  it('keeps row 0 when a cell is too long to be a label', () => {
    const longBack =
      'A really long answer that runs well past the heuristic length cap used to spot label-shaped rows';
    const buffer = buildXlsxBuffer([
      ['hola', longBack],
      ['adiós', 'goodbye'],
    ]);
    const html = convertXLSXToHTML(buffer, 'deck.html');
    expect(html).toContain('<summary>hola</summary>');
    expect(html).toContain('<summary>adiós</summary>');
  });
});

describe('convertXLSXToHTML cell escaping', () => {
  it('renders markup in cell text as literal characters', () => {
    const buffer = buildXlsxBuffer([
      ['front', 'back'],
      ['<script>alert(1)</script>', 'a "quote" and <b>tag</b>'],
    ]);
    const html = convertXLSXToHTML(buffer, 'Deck');
    expect(html).not.toContain('<script>');
    expect(html).toContain(
      '<summary>&lt;script&gt;alert(1)&lt;/script&gt;</summary>'
    );
    expect(html).toContain('&quot;quote&quot;');
    expect(html).toContain('&lt;b&gt;tag&lt;/b&gt;');
  });

  it('renders markup in the document title as literal characters', () => {
    const buffer = buildXlsxBuffer([
      ['front', 'back'],
      ['hola', 'hello'],
    ]);
    const html = convertXLSXToHTML(buffer, '<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<title><img');
    expect(html).toContain('<title>&lt;img src=x onerror=alert(1)&gt;</title>');
  });
});

describe('convertXLSXToHTML header-name mapping', () => {
  it('maps front and back by column name when the header order is reversed', () => {
    const buffer = buildXlsxBuffer([
      ['back', 'front'],
      ['Hello', 'Bonjour'],
    ]);
    const html = convertXLSXToHTML(buffer, 'Vocab');
    expect(html).toContain('<summary>Bonjour</summary>');
    expect(html).toContain('<p>Hello</p>');
  });

  it('detects a question/answer header and maps by name', () => {
    const buffer = buildXlsxBuffer([
      ['answer', 'question'],
      ['4', 'What is 2+2?'],
    ]);
    const html = convertXLSXToHTML(buffer, 'Math');
    expect(html).toContain('<summary>What is 2+2?</summary>');
    expect(html).toContain('<p>4</p>');
  });

  it('detects a term/definition header and maps by name', () => {
    const buffer = buildXlsxBuffer([
      ['term', 'definition'],
      ['Dog', 'Animal'],
    ]);
    const html = convertXLSXToHTML(buffer, 'Vocab');
    expect(html).toContain('<summary>Dog</summary>');
    expect(html).toContain('<p>Animal</p>');
    expect(html).not.toContain('<summary>term</summary>');
  });

  it('falls back to positional mapping and drops a generic header row', () => {
    const buffer = buildXlsxBuffer([
      ['Term', 'Definition'],
      ['Dog', 'Animal'],
    ]);
    const html = convertXLSXToHTML(buffer, 'Deck');
    expect(html).toContain('<summary>Dog</summary>');
    expect(html).toContain('<p>Animal</p>');
    expect(html).not.toContain('<summary>Term</summary>');
    expect(html).not.toContain('Definition');
  });
});
