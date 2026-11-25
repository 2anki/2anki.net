import { UnreadableDocument, XmlTagReader } from './docxXmlTags';

const NO_DEADLINE = Number.MAX_SAFE_INTEGER;

function tagsOf(xml: string) {
  const reader = new XmlTagReader(xml, 0, xml.length, NO_DEADLINE);
  const tags: string[] = [];
  while (reader.next()) tags.push(`${reader.kind}:${reader.name}`);
  return tags;
}

function firstTag(xml: string): XmlTagReader {
  const reader = new XmlTagReader(xml, 0, xml.length, NO_DEADLINE);
  reader.next();
  return reader;
}

describe('XmlTagReader', () => {
  it('reads open, close and empty tags in order, skipping comments, CDATA and declarations', () => {
    expect(
      tagsOf(
        '<?xml version="1.0"?><w:p a=">"><!-- <w:r> --><w:t><![CDATA[<x>]]></w:t><w:br/></w:p >'
      )
    ).toEqual(['open:w:p', 'open:w:t', 'close:w:t', 'empty:w:br', 'close:w:p']);
  });

  it.each([
    ['double quotes', '<w:ilvl w:val="1"/>'],
    ['single quotes', "<w:ilvl w:val='1'/>"],
    ['spaces around the equals sign', '<w:ilvl  w:val =\t"1" />'],
  ])('reads an attribute written with %s', (_kind, xml) => {
    expect(firstTag(xml).attribute('w:val')).toBe('1');
  });

  it('declines an attribute it needs that holds an entity', () => {
    expect(() =>
      firstTag('<w:fldChar w:fldCharType="&#98;egin"/>').attribute(
        'w:fldCharType'
      )
    ).toThrow(UnreadableDocument);
  });

  it('reads an attribute next to another that holds an entity', () => {
    expect(
      firstTag(
        '<Relationship Target="https://example.com/?a=1&amp;b=2" Type="t"/>'
      ).attribute('Type')
    ).toBe('t');
  });

  it.each([
    ['an unterminated tag', '<w:p a="1"'],
    ['an unterminated comment', '<w:p><!-- never closed'],
    ['a document type declaration', '<!DOCTYPE x [<!ENTITY e "v">]><w:p/>'],
    ['a tag with no name', '< w:p>'],
  ])('declines %s', (_kind, xml) => {
    expect(() => tagsOf(xml)).toThrow(UnreadableDocument);
  });

  it('declines an attribute with no quotes', () => {
    expect(() => firstTag('<w:ilvl w:val=1/>').attribute('w:val')).toThrow(
      UnreadableDocument
    );
  });

  it('gives up once its deadline has passed', () => {
    const xml = '<w:r/>'.repeat(10_000);
    const reader = new XmlTagReader(xml, 0, xml.length, 0);

    expect(() => {
      while (reader.next());
    }).toThrow(UnreadableDocument);
  });
});
