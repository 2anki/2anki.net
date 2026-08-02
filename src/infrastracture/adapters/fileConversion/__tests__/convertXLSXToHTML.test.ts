import { readFileSync } from 'fs';
import Workspace from '../../../../lib/parser/WorkSpace';
import { convertXLSXToHTML } from '../convertXLSXToHTML';
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

describe('convertXLSXToHTML header detection', () => {
  it('keeps every row of a headerless short-text sheet (#3945)', () => {
    const buffer = buildXlsxBuffer([
      ['Fotossíntese', 'Processo de conversão de luz em energia'],
      ['Mitose', 'Divisão celular'],
    ]);
    const html = convertXLSXToHTML(buffer, 'deck.html');
    expect(html).toContain('<summary>Fotossíntese</summary>');
    expect(html).toContain('<summary>Mitose</summary>');
  });

  it('keeps an unrecognized header row as a visible card', () => {
    const buffer = buildXlsxBuffer([
      ['Vocabulary', 'Meaning'],
      ['hola', 'hello'],
    ]);
    const html = convertXLSXToHTML(buffer, 'deck.html');
    expect(html).toContain('<summary>Vocabulary</summary>');
    expect(html).toContain('<summary>hola</summary>');
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

  it.each([
    ['German', 'Frage', 'Antwort'],
    ['German', 'Vorderseite', 'Rückseite'],
    ['Spanish', 'Pregunta', 'Respuesta'],
    ['Spanish', 'Anverso', 'Reverso'],
    ['Portuguese', 'Frente', 'Verso'],
    ['Portuguese', 'Pergunta', 'Resposta'],
  ])('drops a %s %s/%s header row', (_locale, front, back) => {
    const buffer = buildXlsxBuffer([
      [front, back],
      ['hola', 'hello'],
    ]);
    const html = convertXLSXToHTML(buffer, 'deck.html');
    expect(html).not.toContain(`<summary>${front}</summary>`);
    expect(html).toContain('<summary>hola</summary>');
  });

  it('maps columns by name for a reversed localized header', () => {
    const buffer = buildXlsxBuffer([
      ['Antwort', 'Frage'],
      ['Hallo', 'Was heißt hello?'],
    ]);
    const html = convertXLSXToHTML(buffer, 'Vokabeln');
    expect(html).toContain('<summary>Was heißt hello?</summary>');
    expect(html).toContain('<p>Hallo</p>');
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

  it('drops a capitalized Term/Definition header via the named match', () => {
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
