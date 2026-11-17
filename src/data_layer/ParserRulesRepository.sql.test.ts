import knex, { Knex } from 'knex';
import ParserRulesRepository from './ParserRulesRepository';

describe('ParserRulesRepository generated SQL', () => {
  let db: Knex;
  let captured: { sql: string; bindings: readonly unknown[] }[];

  beforeAll(() => {
    db = knex({ client: 'pg' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    captured = [];
  });

  const recordingDatabase = (): Knex => {
    const wrapped = ((table: string) => {
      const builder = db(table);
      builder.then = ((resolve: (value: unknown) => unknown) => {
        const compiled = builder.toSQL().toNative();
        captured.push({ sql: compiled.sql, bindings: compiled.bindings });
        return Promise.resolve(resolve(undefined));
      }) as typeof builder.then;
      return builder;
    }) as unknown as Knex;
    return wrapped;
  };

  it('upserts on owner and page, updating only the rule columns', async () => {
    const repository = new ParserRulesRepository(recordingDatabase());

    await repository.create('page-1', '7', {
      FLASHCARD: 'toggle',
      DECK: 'page',
      SUB_DECKS: 'child_page',
      TAGS: 'strikethrough',
      EMAIL_NOTIFICATION: 'false',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toBe(
      'insert into "parser_rules" ("deck_is", "email_notification", "flashcard_is", "object_id", "owner", "sub_deck_is", "tags_is") values ($1, $2, $3, $4, $5, $6, $7) on conflict ("owner", "object_id") do update set "flashcard_is" = excluded."flashcard_is", "deck_is" = excluded."deck_is", "sub_deck_is" = excluded."sub_deck_is", "tags_is" = excluded."tags_is", "email_notification" = excluded."email_notification"'
    );
  });

  it('reads only the signed-in owner row for a page', async () => {
    const repository = new ParserRulesRepository(recordingDatabase());

    await repository.findForOwner('7', 'page-1');

    expect(captured).toEqual([
      {
        sql: 'select "flashcard_is", "deck_is", "sub_deck_is", "tags_is", "email_notification" from "parser_rules" where "owner" = $1 and "object_id" = $2 limit $3',
        bindings: ['7', 'page-1', 1],
      },
    ]);
  });
});
