import knexLib, { Knex } from 'knex';
import SettingsRepository from './SettingsRepository';
import CardOption from '../lib/parser/Settings/CardOption';

const TEMPLATES_PAYLOAD = [
  {
    parent: 'Basic',
    name: 'ATTI BASIC',
    storageKey: 'n2a-basic',
    front: '<div class="atti">{{Front}}</div>',
    back: '<div class="atti-back">{{Back}}</div>',
    styling: '.atti { color: tomato; }',
  },
];

const NOTE_TYPE_EDITOR_PAYLOAD = {
  templates: [
    {
      id: 'user-60392fd1-619c-43b2-8cab-20395a71b9cf',
      name: 'ATTI BASIC',
      description: '',
      baseType: 'basic',
      noteType: {
        id: 1780929933237,
        name: 'ATTI BASIC',
        type: 0,
        tmpls: [
          {
            name: 'Card 1',
            ord: 0,
            qfmt: '<span class="atti-front">{{Front}}</span>',
            afmt: '<span class="atti-front">{{Front}}</span><hr>{{Back}}',
          },
        ],
        flds: [
          { name: 'Front', ord: 0 },
          { name: 'Back', ord: 1 },
        ],
        css: '.atti-front { color: teal; }',
      },
      previewData: { Front: 'Q', Back: 'A' },
      tags: [],
    },
  ],
  hiddenIds: [],
};

describe('SettingsRepository.loadAnkifyTemplateOverrides', () => {
  let db: Knex;
  let repo: SettingsRepository;

  beforeEach(async () => {
    db = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('settings', (t) => {
      t.string('owner');
      t.string('object_id');
      t.string('title');
      t.json('payload');
      t.timestamp('updated_at').defaultTo(db.fn.now());
    });
    await db.schema.createTable('templates', (t) => {
      t.string('owner');
      t.json('payload');
    });
    await db.schema.createTable('users', (t) => {
      t.integer('id');
      t.json('card_options');
    });
    repo = new SettingsRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test('returns the override when settings.template is "custom" and a basic template is saved', async () => {
    await db('settings').insert({
      owner: '42',
      object_id: 'page-a',
      title: 'A',
      payload: JSON.stringify({
        payload: { template: 'custom', basic_model_name: 'ATTI BASIC' },
      }),
      updated_at: db.fn.now(),
    });
    await db('templates').insert({
      owner: '42',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides('42');

    expect(overrides).not.toBeNull();
    expect(overrides?.basicModelName).toBe('ATTI BASIC');
    expect(overrides?.basicTemplate.front).toContain('atti');
    expect(overrides?.basicTemplate.styling).toContain('tomato');
  });

  test('returns null when template is not "custom"', async () => {
    await db('settings').insert({
      owner: '42',
      object_id: 'page-a',
      title: 'A',
      payload: JSON.stringify({
        payload: { template: 'specialstyle1', basic_model_name: 'ATTI BASIC' },
      }),
    });
    await db('templates').insert({
      owner: '42',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides('42');

    expect(overrides).toBeNull();
  });

  test('returns null when there is no templates row even though template === custom', async () => {
    await db('settings').insert({
      owner: '42',
      object_id: 'page-a',
      title: 'A',
      payload: JSON.stringify({
        payload: { template: 'custom', basic_model_name: 'ATTI BASIC' },
      }),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides('42');

    expect(overrides).toBeNull();
  });

  test('returns null when the owner has no settings rows at all', async () => {
    const overrides = await repo.loadAnkifyTemplateOverrides('99');
    expect(overrides).toBeNull();
  });

  test('falls back to users.card_options when the owner has no settings row but set a custom template globally', async () => {
    await db('users').insert({
      id: 13574,
      card_options: JSON.stringify({
        template: 'custom',
        basic_model_name: 'ATTI BASIC',
      }),
    });
    await db('templates').insert({
      owner: '13574',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides('13574');

    expect(overrides).not.toBeNull();
    expect(overrides?.basicModelName).toBe('ATTI BASIC');
    expect(overrides?.basicTemplate.front).toContain('atti');
  });

  test('prefers a per-page settings row over global card_options', async () => {
    await db('users').insert({
      id: 13574,
      card_options: JSON.stringify({
        template: 'custom',
        basic_model_name: 'GLOBAL NAME',
      }),
    });
    await db('settings').insert({
      owner: '13574',
      object_id: 'page-a',
      title: 'A',
      payload: JSON.stringify({
        payload: { template: 'custom', basic_model_name: 'PAGE NAME' },
      }),
    });
    await db('templates').insert({
      owner: '13574',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides('13574', 'page-a');

    expect(overrides?.basicModelName).toBe('PAGE NAME');
  });

  test('honors the synced page row even when a newer non-custom row for another page exists', async () => {
    await db('settings').insert({
      owner: '42',
      object_id: 'synced-page',
      title: 'Synced',
      payload: JSON.stringify({
        payload: { template: 'custom', basic_model_name: 'ATTI BASIC' },
      }),
      updated_at: '2026-06-01 00:00:00',
    });
    await db('settings').insert({
      owner: '42',
      object_id: 'other-page',
      title: 'Other',
      payload: JSON.stringify({
        payload: { template: 'specialstyle1' },
      }),
      updated_at: '2026-06-10 00:00:00',
    });
    await db('templates').insert({
      owner: '42',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides(
      '42',
      'synced-page'
    );

    expect(overrides).not.toBeNull();
    expect(overrides?.basicModelName).toBe('ATTI BASIC');
  });

  test('falls back to global card_options when the synced page has no custom row', async () => {
    await db('users').insert({
      id: 42,
      card_options: JSON.stringify({
        template: 'custom',
        basic_model_name: 'GLOBAL NAME',
      }),
    });
    await db('settings').insert({
      owner: '42',
      object_id: 'synced-page',
      title: 'Synced',
      payload: JSON.stringify({
        payload: { template: 'specialstyle1' },
      }),
      updated_at: '2026-06-10 00:00:00',
    });
    await db('templates').insert({
      owner: '42',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides(
      '42',
      'synced-page'
    );

    expect(overrides?.basicModelName).toBe('GLOBAL NAME');
  });

  test('falls back to the database row when a database child page has no row of its own', async () => {
    await db('settings').insert({
      owner: '42',
      object_id: 'database-id',
      title: 'Database',
      payload: JSON.stringify({
        payload: { template: 'custom', basic_model_name: 'ATTI BASIC' },
      }),
      updated_at: '2026-06-01 00:00:00',
    });
    await db('settings').insert({
      owner: '42',
      object_id: 'other-page',
      title: 'Other',
      payload: JSON.stringify({
        payload: { template: 'specialstyle1' },
      }),
      updated_at: '2026-06-10 00:00:00',
    });
    await db('templates').insert({
      owner: '42',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides(
      '42',
      'child-page-without-row',
      'database-id'
    );

    expect(overrides).not.toBeNull();
    expect(overrides?.basicModelName).toBe('ATTI BASIC');
  });

  test('prefers the child page row over the database fallback row', async () => {
    await db('settings').insert({
      owner: '42',
      object_id: 'database-id',
      title: 'Database',
      payload: JSON.stringify({
        payload: { template: 'custom', basic_model_name: 'DATABASE NAME' },
      }),
    });
    await db('settings').insert({
      owner: '42',
      object_id: 'child-page',
      title: 'Child',
      payload: JSON.stringify({
        payload: { template: 'custom', basic_model_name: 'CHILD NAME' },
      }),
    });
    await db('templates').insert({
      owner: '42',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides(
      '42',
      'child-page',
      'database-id'
    );

    expect(overrides?.basicModelName).toBe('CHILD NAME');
  });

  test('resolves a template saved by the note-type editor payload shape', async () => {
    await db('users').insert({
      id: 13574,
      card_options: JSON.stringify({
        template: 'custom',
        basic_model_name: 'ATTI BASIC',
      }),
    });
    await db('templates').insert({
      owner: '13574',
      payload: JSON.stringify(NOTE_TYPE_EDITOR_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides('13574');

    expect(overrides).not.toBeNull();
    expect(overrides?.basicModelName).toBe('ATTI BASIC');
    expect(overrides?.basicTemplate.front).toContain('atti-front');
    expect(overrides?.basicTemplate.styling).toContain('teal');
  });

  test('returns null when global card_options template is not custom', async () => {
    await db('users').insert({
      id: 13574,
      card_options: JSON.stringify({
        template: 'specialstyle1',
        basic_model_name: 'ATTI BASIC',
      }),
    });
    await db('templates').insert({
      owner: '13574',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });

    const overrides = await repo.loadAnkifyTemplateOverrides('13574');

    expect(overrides).toBeNull();
  });
});

describe('SettingsRepository.attachCustomTemplates', () => {
  let db: Knex;
  let repo: SettingsRepository;

  beforeEach(async () => {
    db = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('templates', (t) => {
      t.string('owner');
      t.json('payload');
    });
    repo = new SettingsRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test('attaches the saved custom templates when template is "custom"', async () => {
    await db('templates').insert({
      owner: '42',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });
    const settings = new CardOption({
      ...CardOption.LoadDefaultOptions(),
      template: 'custom',
      basic_model_name: 'ATTI BASIC',
    });

    await repo.attachCustomTemplates('42', settings);

    expect(settings.n2aBasic?.styling).toContain('tomato');
    expect(settings.n2aBasic?.name).toBe('ATTI BASIC');
  });

  test('attaches templates saved by the note-type editor payload shape', async () => {
    await db('templates').insert({
      owner: '42',
      payload: JSON.stringify(NOTE_TYPE_EDITOR_PAYLOAD),
    });
    const settings = new CardOption({
      ...CardOption.LoadDefaultOptions(),
      template: 'custom',
      basic_model_name: 'ATTI BASIC',
    });

    await repo.attachCustomTemplates('42', settings);

    expect(settings.n2aBasic?.front).toContain('atti-front');
    expect(settings.n2aBasic?.styling).toContain('teal');
    expect(settings.n2aBasic?.name).toBe('ATTI BASIC');
  });

  test('leaves the settings untouched when template is not "custom"', async () => {
    await db('templates').insert({
      owner: '42',
      payload: JSON.stringify(TEMPLATES_PAYLOAD),
    });
    const settings = new CardOption({
      ...CardOption.LoadDefaultOptions(),
      template: 'specialstyle',
    });

    await repo.attachCustomTemplates('42', settings);

    expect(settings.n2aBasic).toBeUndefined();
  });

  test('leaves the settings untouched when the owner has no templates row', async () => {
    const settings = new CardOption({
      ...CardOption.LoadDefaultOptions(),
      template: 'custom',
    });

    await repo.attachCustomTemplates('42', settings);

    expect(settings.n2aBasic).toBeUndefined();
  });
});

describe('SettingsRepository owner scoping and payload shapes', () => {
  let db: Knex;
  let repo: SettingsRepository;

  beforeEach(async () => {
    db = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('settings', (t) => {
      t.increments('id');
      t.string('owner').notNullable();
      t.string('object_id').notNullable();
      t.string('title');
      t.json('payload').notNullable();
      t.timestamp('updated_at').defaultTo(db.fn.now());
      t.unique(['owner', 'object_id']);
    });
    await db.schema.createTable('templates', (t) => {
      t.string('owner');
      t.json('payload');
    });
    repo = new SettingsRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test('reads the deck name from a legacy wrapper row', async () => {
    await db('settings').insert({
      owner: '42',
      object_id: 'page-a',
      title: 'A',
      payload: JSON.stringify({
        object_id: 'page-a',
        title: 'A',
        payload: { deckName: 'Wrapped Deck' },
      }),
    });

    const settings = await repo.loadIfExists('42', 'page-a');

    expect(settings?.deckName).toBe('Wrapped Deck');
  });

  test('reads the deck name from a new flat row', async () => {
    await db('settings').insert({
      owner: '42',
      object_id: 'page-b',
      title: 'B',
      payload: JSON.stringify({ deckName: 'Flat Deck' }),
    });

    const settings = await repo.loadIfExists('42', 'page-b');

    expect(settings?.deckName).toBe('Flat Deck');
  });

  test('carries a saved page style change time into the conversion settings', async () => {
    await repo.create({
      owner: '42',
      object_id: 'page-style',
      payload: { 'font-size': '32', 'style-changed-at': '1793000000' },
      title: 'Styled',
    });

    const settings = await repo.loadIfExists('42', 'page-style');

    expect(settings?.styleChangedAt).toBe(1793000000);
  });

  test('returns null when no row exists for the owner and page', async () => {
    const settings = await repo.loadIfExists('42', 'missing');
    expect(settings).toBeNull();
  });

  test('two owners saving the same object_id keep separate rows', async () => {
    await repo.create({
      owner: 'owner-a',
      object_id: 'shared-page',
      payload: JSON.stringify({ payload: { deck_name: 'Deck A' } }),
      title: 'A',
    });
    await repo.create({
      owner: 'owner-b',
      object_id: 'shared-page',
      payload: JSON.stringify({ payload: { deck_name: 'Deck B' } }),
      title: 'B',
    });

    const rows = await db('settings')
      .where({ object_id: 'shared-page' })
      .orderBy('owner');

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.owner)).toEqual(['owner-a', 'owner-b']);
  });

  test('re-saving the same owner + object_id updates that owner row in place', async () => {
    await repo.create({
      owner: 'owner-a',
      object_id: 'shared-page',
      payload: JSON.stringify({ payload: { deck_name: 'First' } }),
      title: 'First',
    });
    await repo.create({
      owner: 'owner-a',
      object_id: 'shared-page',
      payload: JSON.stringify({ payload: { deck_name: 'Second' } }),
      title: 'Second',
    });

    const rows = await db('settings').where({ owner: 'owner-a' });

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Second');
  });

  test('one owner saving cannot overwrite another owner row', async () => {
    await repo.create({
      owner: 'owner-a',
      object_id: 'shared-page',
      payload: JSON.stringify({ payload: { deck_name: 'Deck A' } }),
      title: 'A',
    });
    await repo.create({
      owner: 'owner-b',
      object_id: 'shared-page',
      payload: JSON.stringify({ payload: { deck_name: 'Deck B' } }),
      title: 'B',
    });

    const ownerARow = await db('settings')
      .where({ owner: 'owner-a', object_id: 'shared-page' })
      .first();

    expect(ownerARow.title).toBe('A');
  });

  test('getById scoped by owner returns only that owner row', async () => {
    await repo.create({
      owner: 'owner-a',
      object_id: 'shared-page',
      payload: JSON.stringify({ payload: { deck_name: 'Deck A' } }),
      title: 'A',
    });
    await repo.create({
      owner: 'owner-b',
      object_id: 'shared-page',
      payload: JSON.stringify({ payload: { deck_name: 'Deck B' } }),
      title: 'B',
    });

    const ownerBResult = await repo.getById('owner-b', 'shared-page');

    expect(JSON.parse(ownerBResult.payload)).toEqual({
      payload: { deck_name: 'Deck B' },
    });
  });

  test('getById returns undefined when the page belongs to another owner', async () => {
    await repo.create({
      owner: 'owner-a',
      object_id: 'shared-page',
      payload: JSON.stringify({ payload: { deck_name: 'Deck A' } }),
      title: 'A',
    });

    const result = await repo.getById('owner-b', 'shared-page');

    expect(result).toBeUndefined();
  });
});
