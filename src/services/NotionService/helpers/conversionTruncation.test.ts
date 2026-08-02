import {
  buildNotionConversionSignalPayload,
  hasRuleBasedSubDecks,
  isTruncatedBlockFetch,
} from './conversionTruncation';

describe('isTruncatedBlockFetch', () => {
  it.each([
    [false, true, true],
    [false, false, false],
    [true, true, false],
    [true, false, false],
  ])('all=%s has_more=%s -> %s', (all, hasMore, expected) => {
    expect(isTruncatedBlockFetch(all, { has_more: hasMore })).toBe(expected);
  });
});

describe('hasRuleBasedSubDecks', () => {
  it('is false for the default child_page-only rule', () => {
    expect(hasRuleBasedSubDecks({ SUB_DECKS: ['child_page'] })).toBe(false);
  });

  it('is false when no sub-deck types are selected', () => {
    expect(hasRuleBasedSubDecks({ SUB_DECKS: [] })).toBe(false);
  });

  it.each([
    ['toggle'],
    ['heading_1'],
    ['heading_2'],
    ['heading_3'],
    ['child_database'],
  ])('is true when %s is selected', (type) => {
    expect(hasRuleBasedSubDecks({ SUB_DECKS: ['child_page', type] })).toBe(
      true
    );
  });
});

describe('buildNotionConversionSignalPayload', () => {
  it('returns undefined when there is neither truncation nor a dropped asset', () => {
    expect(buildNotionConversionSignalPayload(undefined, 0)).toBeUndefined();
  });

  it('serializes a namespaced truncation payload', () => {
    const payload = buildNotionConversionSignalPayload(
      { blocksConverted: 100, subDeckRulesSkipped: true },
      0
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_truncated',
      blocks_converted: 100,
      sub_deck_rules_skipped: true,
    });
  });

  it('serializes a dropped-assets-only payload', () => {
    const payload = buildNotionConversionSignalPayload(undefined, 3);
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_assets_dropped',
      dropped_assets: 3,
    });
  });

  it('merges co-occurring truncation and dropped assets into one object', () => {
    const payload = buildNotionConversionSignalPayload(
      { blocksConverted: 100, subDeckRulesSkipped: false },
      2
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_truncated',
      blocks_converted: 100,
      sub_deck_rules_skipped: false,
      dropped_assets: 2,
    });
  });

  it('serializes a structure-rescued payload carrying the winning rule', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      0,
      undefined,
      undefined,
      undefined,
      'heading'
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_structure_rescued',
      rule: 'heading',
    });
  });

  it('surfaces the rescue rule even when the conversion also truncated', () => {
    const payload = buildNotionConversionSignalPayload(
      { blocksConverted: 100, subDeckRulesSkipped: false },
      0,
      undefined,
      undefined,
      undefined,
      'heading'
    );
    expect(JSON.parse(payload as string)).toMatchObject({
      code: 'notion_structure_rescued',
      rule: 'heading',
    });
  });

  it('gives a rescued deck priority over co-occurring softer signals', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      4,
      { frontField: 'Notes', backField: 'Tags' },
      undefined,
      undefined,
      'bullets'
    );
    expect(JSON.parse(payload as string)).toMatchObject({
      code: 'notion_structure_rescued',
      rule: 'bullets',
    });
  });

  it('serializes a guessed-columns-only payload', () => {
    const payload = buildNotionConversionSignalPayload(undefined, 0, {
      frontField: 'Notes',
      backField: 'Tags',
    });
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_columns_guessed',
      front_field: 'Notes',
      back_field: 'Tags',
    });
  });

  it('serializes a resolved-database-path-only payload for a clean database conversion', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      0,
      undefined,
      { viaPageLinkSelfHeal: false }
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_database_resolved',
      via_page_link_selfheal: false,
    });
  });

  it('flags the self-heal entry point on a clean database conversion', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      0,
      undefined,
      { viaPageLinkSelfHeal: true }
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_database_resolved',
      via_page_link_selfheal: true,
    });
  });

  it('adds via_page_link_selfheal onto the guessed-columns payload rather than competing with it', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      0,
      { frontField: 'Notes', backField: 'Tags' },
      { viaPageLinkSelfHeal: true }
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_columns_guessed',
      front_field: 'Notes',
      back_field: 'Tags',
      via_page_link_selfheal: true,
    });
  });

  it('serializes an unsupported-blocks-only payload', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      0,
      undefined,
      undefined,
      {
        child_database: 2,
        synced_block: 1,
      }
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_unsupported_blocks',
      unsupported_blocks: { child_database: 2, synced_block: 1 },
    });
  });

  it('returns undefined for an empty unsupported-blocks map', () => {
    expect(
      buildNotionConversionSignalPayload(undefined, 0, undefined, undefined, {})
    ).toBeUndefined();
  });

  it('adds unsupported_blocks onto a truncation payload rather than competing with it', () => {
    const payload = buildNotionConversionSignalPayload(
      { blocksConverted: 100, subDeckRulesSkipped: false },
      0,
      undefined,
      undefined,
      { child_database: 1 }
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_truncated',
      blocks_converted: 100,
      sub_deck_rules_skipped: false,
      unsupported_blocks: { child_database: 1 },
    });
  });

  it('adds unsupported_blocks onto a dropped-assets payload rather than competing with it', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      3,
      undefined,
      undefined,
      { synced_block: 2 }
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_assets_dropped',
      dropped_assets: 3,
      unsupported_blocks: { synced_block: 2 },
    });
  });

  it('adds unsupported_blocks onto a guessed-columns payload rather than competing with it', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      0,
      { frontField: 'Notes', backField: 'Tags' },
      undefined,
      { child_database: 1 }
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_columns_guessed',
      front_field: 'Notes',
      back_field: 'Tags',
      unsupported_blocks: { child_database: 1 },
    });
  });

  it('serializes a forbidden-blocks-only payload', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      2
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_blocks_forbidden',
      forbidden_blocks: 2,
    });
  });

  it('returns undefined when the forbidden-block count is zero', () => {
    expect(
      buildNotionConversionSignalPayload(
        undefined,
        0,
        undefined,
        undefined,
        undefined,
        undefined,
        0
      )
    ).toBeUndefined();
  });

  it('ranks forbidden blocks above truncation but keeps the truncation fields', () => {
    const payload = buildNotionConversionSignalPayload(
      { blocksConverted: 100, subDeckRulesSkipped: false },
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      3
    );
    expect(JSON.parse(payload as string)).toEqual({
      code: 'notion_blocks_forbidden',
      blocks_converted: 100,
      sub_deck_rules_skipped: false,
      forbidden_blocks: 3,
    });
  });

  it('keeps structure-rescued ranked above forbidden blocks', () => {
    const payload = buildNotionConversionSignalPayload(
      undefined,
      0,
      undefined,
      undefined,
      undefined,
      'heading',
      4
    );
    expect(JSON.parse(payload as string)).toMatchObject({
      code: 'notion_structure_rescued',
      rule: 'heading',
      forbidden_blocks: 4,
    });
  });

  it('does not collide with the apkg_import done payload shape', () => {
    const parsed = JSON.parse(
      buildNotionConversionSignalPayload(
        { blocksConverted: 100, subDeckRulesSkipped: false },
        1
      ) as string
    );
    expect(parsed.total_notes).toBeUndefined();
    expect(parsed.imported).toBeUndefined();
    expect(parsed.notion_page_url).toBeUndefined();
  });
});
