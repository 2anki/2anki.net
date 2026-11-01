import TagRegistry from './TagRegistry';

describe('TagRegistry', () => {
  it('collects strikethroughs into its own array', () => {
    const registry = new TagRegistry();

    registry.addStrikethrough('chapter-1');
    registry.addStrikethrough('verb');

    expect(registry.strikethroughs).toEqual(['chapter-1', 'verb']);
  });

  it('clear empties the strikethroughs', () => {
    const registry = new TagRegistry();
    registry.addStrikethrough('done');

    registry.clear();

    expect(registry.strikethroughs).toEqual([]);
  });

  it('refuses strikethroughs and says so when tags are off', () => {
    const registry = new TagRegistry(() => false);

    expect(registry.addStrikethrough('kept-as-text')).toBe(false);
    expect(registry.strikethroughs).toEqual([]);
  });

  it('says a strikethrough became a tag when it collects it', () => {
    const registry = new TagRegistry();

    expect(registry.addStrikethrough('chapter-1')).toBe(true);
  });

  it('isolates state across instances so interleaved conversions never share tags', () => {
    const conversionA = new TagRegistry();
    const conversionB = new TagRegistry();

    conversionA.addStrikethrough('a-tag');
    conversionB.addStrikethrough('b-tag');
    conversionB.clear();

    expect(conversionA.strikethroughs).toEqual(['a-tag']);
    expect(conversionB.strikethroughs).toEqual([]);
  });
});
