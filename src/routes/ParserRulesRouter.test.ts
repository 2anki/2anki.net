import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import knex, { Knex } from 'knex';

const mockDatabase = vi.hoisted(() => ({
  instance: null as unknown as Knex,
}));

vi.mock('../data_layer', () => ({
  getDatabase: () => mockDatabase.instance,
}));

vi.mock('./middleware/RequireAuthentication', () => ({
  __esModule: true,
  default: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const owner = req.header('x-test-owner');
    if (owner == null) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    res.locals.owner = owner;
    next();
  },
}));

import ParserRulesRouter from './ParserRulesRouter';
import ParserRules from '../lib/parser/ParserRules';

const ACCOUNT_A = '101';
const ACCOUNT_B = '202';
const SHARED_PAGE = '7ccef4f6b50c4599878ef6fb61415ce2';

const RULES_A = {
  FLASHCARD: 'toggle,heading_1',
  DECK: 'page',
  SUB_DECKS: 'child_page',
  TAGS: 'heading',
  EMAIL_NOTIFICATION: true,
};

const RULES_B = {
  FLASHCARD: 'callout',
  DECK: 'page,database',
  SUB_DECKS: 'toggle',
  TAGS: 'strikethrough',
  EMAIL_NOTIFICATION: false,
};

describe('ParserRulesRouter', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    mockDatabase.instance = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await mockDatabase.instance.schema.createTable('parser_rules', (t) => {
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
    const app = express();
    app.use(express.json());
    app.use(ParserRulesRouter());
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await mockDatabase.instance.destroy();
  });

  beforeEach(async () => {
    await mockDatabase.instance('parser_rules').del();
  });

  const saveRules = (owner: string, payload: unknown, page = SHARED_PAGE) =>
    fetch(`${baseUrl}/api/rules/create/${page}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-owner': owner },
      body: JSON.stringify({ payload }),
    });

  const findRules = (owner: string, page = SHARED_PAGE) =>
    fetch(`${baseUrl}/api/rules/find/${page}`, {
      headers: { 'x-test-owner': owner },
    });

  const deleteRules = (owner: string, page = SHARED_PAGE) =>
    fetch(`${baseUrl}/api/rules/${page}`, {
      method: 'DELETE',
      headers: { 'x-test-owner': owner },
    });

  describe('a user saving and reading rules for a page', () => {
    it('returns only the rule fields the Rules page reads', async () => {
      expect((await saveRules(ACCOUNT_A, RULES_A)).status).toBe(201);

      const response = await findRules(ACCOUNT_A);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        flashcard_is: 'toggle,heading_1',
        deck_is: 'page',
        sub_deck_is: 'child_page',
        tags_is: 'heading',
        email_notification: true,
      });
    });

    it('answers 200 with an empty body when the account has no rules for the page', async () => {
      const response = await findRules(ACCOUNT_A);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    });

    it('replaces the account rules when it saves again', async () => {
      await saveRules(ACCOUNT_A, RULES_A);
      await saveRules(ACCOUNT_A, RULES_B);

      const body = await (await findRules(ACCOUNT_A)).json();
      const rows = await mockDatabase.instance('parser_rules').select('owner');

      expect(body.flashcard_is).toBe('callout');
      expect(rows).toEqual([{ owner: Number(ACCOUNT_A) }]);
    });
  });

  describe('two accounts using one shared page', () => {
    it('keeps a separate set of rules for each account', async () => {
      await saveRules(ACCOUNT_A, RULES_A);
      expect((await saveRules(ACCOUNT_B, RULES_B)).status).toBe(201);

      const bodyA = await (await findRules(ACCOUNT_A)).json();
      const bodyB = await (await findRules(ACCOUNT_B)).json();

      expect(bodyA).toMatchObject({ flashcard_is: 'toggle,heading_1' });
      expect(bodyB).toMatchObject({ flashcard_is: 'callout' });
    });

    it('loads each account its own rules for a conversion', async () => {
      await saveRules(ACCOUNT_A, RULES_A);
      await saveRules(ACCOUNT_B, RULES_B);

      const rulesA = await ParserRules.Load(ACCOUNT_A, SHARED_PAGE);
      const rulesB = await ParserRules.Load(ACCOUNT_B, SHARED_PAGE);

      expect(rulesA.flashcardTypes()).toEqual(['toggle', 'heading_1']);
      expect(rulesA.TAGS).toBe('heading');
      expect(rulesB.flashcardTypes()).toEqual(['callout']);
      expect(rulesB.deckTypes()).toEqual(['page', 'database']);
    });

    it('shows an account with no rules of its own the defaults answer', async () => {
      await saveRules(ACCOUNT_A, RULES_A);

      const response = await findRules(ACCOUNT_B);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    });

    it('leaves the other account rules in place when one account resets the page', async () => {
      await saveRules(ACCOUNT_A, RULES_A);

      expect((await deleteRules(ACCOUNT_B)).status).toBe(204);

      const bodyA = await (await findRules(ACCOUNT_A)).json();
      expect(bodyA).toMatchObject({ flashcard_is: 'toggle,heading_1' });
    });
  });

  describe('flashcard type validation', () => {
    it('rejects an empty flashcard type list', async () => {
      const response = await saveRules(ACCOUNT_A, {
        ...RULES_A,
        FLASHCARD: '',
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        message: 'Choose at least one block type to turn into flashcards.',
      });
      expect(await mockDatabase.instance('parser_rules').count()).toEqual([
        { 'count(*)': 0 },
      ]);
    });

    it('rejects a flashcard type the Rules page does not offer', async () => {
      const response = await saveRules(ACCOUNT_A, {
        ...RULES_A,
        FLASHCARD: 'toggle,image',
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        message: 'One or more flashcard types are not supported.',
      });
    });

    it('accepts every flashcard type the Rules page offers', async () => {
      const response = await saveRules(ACCOUNT_A, {
        ...RULES_A,
        FLASHCARD: ParserRules.FLASHCARD_TYPE_ALLOWLIST.join(','),
      });

      expect(response.status).toBe(201);
    });
  });

  describe('stored rows with out-of-list values', () => {
    beforeEach(async () => {
      await mockDatabase.instance('parser_rules').insert({
        owner: Number(ACCOUNT_A),
        object_id: SHARED_PAGE,
        flashcard_is: 'heading,Toggles',
        deck_is: 'Pages',
        sub_deck_is: 'Pages',
        tags_is: 'Headings',
        email_notification: false,
      });
    });

    it('loads them for a conversion without error, keeping the stored flashcard types', async () => {
      const rules = await ParserRules.Load(ACCOUNT_A, SHARED_PAGE);

      expect(rules.flashcardTypes()).toEqual(['heading', 'Toggles']);
      expect(rules.deckTypes()).toEqual(['page', 'database']);
    });

    it('returns them to the Rules page as stored', async () => {
      const body = await (await findRules(ACCOUNT_A)).json();

      expect(body).toEqual({
        flashcard_is: 'heading,Toggles',
        deck_is: 'Pages',
        sub_deck_is: 'Pages',
        tags_is: 'Headings',
        email_notification: false,
      });
    });
  });
});
