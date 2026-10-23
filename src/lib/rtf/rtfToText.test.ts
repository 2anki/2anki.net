import { rtfToText } from './rtfToText';

describe('rtfToText', () => {
  it('keeps the text and paragraph breaks and drops the font and colour tables', () => {
    const rtf =
      '{\\rtf1\\ansi{\\fonttbl\\f0 Helvetica;}{\\colortbl;\\red255\\green0\\blue0;}\\f0 Mitosis - cell division\\par Meiosis - makes gametes\\par}';

    expect(rtfToText(rtf)).toBe(
      'Mitosis - cell division\nMeiosis - makes gametes'
    );
  });

  it('turns TextEdit list items into markdown list lines', () => {
    const rtf =
      '{\\rtf1\\ansi\\pard{\\listtext\t\\uc0\\u8226 \t}Term: definition\\\n{\\listtext\t\\uc0\\u8226 \t}Second: one\\\n}';

    expect(rtfToText(rtf)).toBe('- Term: definition\n- Second: one');
  });

  it('keeps the nesting of indented list items', () => {
    const rtf =
      '{\\rtf1\\ansi\\pard\\li720{\\listtext\t\\uc0\\u8226 \t}Mitosis\\\n\\pard\\li1440{\\listtext\t\\uc0\\u8259 \t}cell division\\\n}';

    expect(rtfToText(rtf)).toBe('- Mitosis\n  - cell division');
  });

  it('decodes hex escapes and unicode with their fallback characters', () => {
    expect(rtfToText("{\\rtf1 Caf\\'e9 \\u8364? \\u-3913?}")).toBe('Café € ');
  });

  it('keeps a link text and never the linked path or picture data', () => {
    const rtf =
      '{\\rtf1 See {\\field{\\*\\fldinst{HYPERLINK "file:///etc/passwd"}}{\\fldrslt the notes}} {\\field{\\*\\fldinst INCLUDEPICTURE "http://169.254.169.254/" \\\\d}{\\fldrslt }}{\\pict\\pngblip 89504e47}{\\object\\objemb{\\*\\objdata 0102}}done}';

    const text = rtfToText(rtf);

    expect(text).toBe('See the notes done');
    expect(text).not.toContain('passwd');
    expect(text).not.toContain('169.254');
  });

  it('keeps escaped braces and backslashes as text', () => {
    expect(rtfToText('{\\rtf1 a \\{b\\} c\\\\d}')).toBe('a {b} c\\d');
  });
});
