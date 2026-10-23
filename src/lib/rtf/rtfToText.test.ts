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

  it('survives hostile input: deep nesting, huge code points and long runs', () => {
    const deep = `{\\rtf1 ${'{'.repeat(100_000)}inside${'}'.repeat(100_000)} after}`;
    expect(rtfToText(deep)).toBe('inside after');
    expect(rtfToText('{\\rtf1 a\\u99999999?b}')).toBe('a\ufffdb');
    expect(rtfToText('{\\rtf1 \\uc999999 \\u65?c}')).toBe('A');
    const long = `{\\rtf1 ${'x'.repeat(2_000_000)}}`;
    expect(rtfToText(long)).toHaveLength(2_000_000);
  });

  it('caps list indents so a tiny file cannot ask for gigabytes of spaces', () => {
    const rtf = `{\\rtf1 ${'\\par\\li400000000 {\\listtext \\bullet\\tab}x'.repeat(1000)}}`;
    const text = rtfToText(rtf);
    expect(text.length).toBeLessThan(40_000);
    expect(text.split('\n')[0]).toBe('- x');
  });

  it('reads a file with a very large list', () => {
    const rtf = `{\\rtf1 ${'{\\listtext \\bullet\\tab}item\\par '.repeat(200_000)}}`;
    expect(rtfToText(rtf).split('\n')).toHaveLength(200_000);
  });
});
