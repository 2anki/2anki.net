import knex, { Knex } from 'knex';
import ParserRulesRepository from './ParserRulesRepository';

const RULES = {
  FLASHCARD: 'toggle',
  DECK: 'page',
  SUB_DECKS: 'child_page',
  TAGS: 'heading',
  EMAIL_NOTIFICATION: 'false',
};

describe('ParserRulesRepository.deleteAllByOwner', () => {
  let db: Knex;
  let repository: ParserRulesRepository;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('parser_rules', (t) => {
      t.increments('id');
      t.string('object_id', 255).notNullable();
      t.string('flashcard_is', 255).notNullable();
      t.string('deck_is', 255).notNullable();
      t.string('sub_deck_is', 255).notNullable();
      t.string('tags_is', 255).notNullable();
      t.integer('owner').notNullable();
      t.boolean('email_notification');
      t.unique(['owner', 'object_id']);
    });
    repository = new ParserRulesRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('removes only that account rules from a shared page', async () => {
    await repository.create('shared-page', '101', RULES);
    await repository.create('own-page', '101', RULES);
    await repository.create('shared-page', '202', RULES);

    expect(await repository.deleteAllByOwner('101')).toBe(2);
    expect(await db('parser_rules').select('owner', 'object_id')).toEqual([
      { owner: 202, object_id: 'shared-page' },
    ]);
  });
});
