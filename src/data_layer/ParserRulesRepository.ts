import { Knex } from 'knex';
import ParserRulesRow from './public/ParserRules';
import ParserRules from '../lib/parser/ParserRules';

export type StoredParserRules = Pick<
  ParserRulesRow,
  'flashcard_is' | 'deck_is' | 'sub_deck_is' | 'tags_is' | 'email_notification'
>;

const STORED_RULE_COLUMNS: (keyof StoredParserRules)[] = [
  'flashcard_is',
  'deck_is',
  'sub_deck_is',
  'tags_is',
  'email_notification',
];

export interface IParserRulesRepository {
  load(owner: string, id: string): Promise<ParserRules>;
}

class ParserRulesRepository implements IParserRulesRepository {
  private readonly tableName: string;

  constructor(private database: Knex) {
    this.tableName = 'parser_rules';
    this.database = database;
  }

  create(
    id: string,
    owner: string,
    input: { [key: string]: string }
  ): Promise<number[]> {
    return this.database(this.tableName)
      .insert({
        owner,
        object_id: id,
        flashcard_is: input.FLASHCARD,
        deck_is: input.DECK,
        sub_deck_is: input.SUB_DECKS,
        tags_is: input.TAGS,
        email_notification: input.EMAIL_NOTIFICATION,
      })
      .onConflict(['owner', 'object_id'])
      .merge(STORED_RULE_COLUMNS);
  }

  findForOwner(
    owner: string,
    objectId: string
  ): Promise<StoredParserRules | undefined> {
    return this.database(this.tableName)
      .select(STORED_RULE_COLUMNS)
      .where({ owner, object_id: objectId })
      .first();
  }

  deleteByObjectId(objectId: string, owner: string): Promise<number> {
    return this.database(this.tableName)
      .where({ object_id: objectId, owner })
      .del();
  }

  deleteAllByOwner(owner: string): Promise<number> {
    return this.database(this.tableName).where({ owner }).del();
  }

  async load(owner: string, id: string): Promise<ParserRules> {
    const rules = new ParserRules();
    try {
      const result = await this.database(this.tableName)
        .where({ object_id: id, owner })
        .returning(['*'])
        .first();

      if (result) {
        rules.setFlashcardTypes(result.flashcard_is.split(','));
        const deckTypes = (result.deck_is ?? '').split(',').filter(Boolean);
        if (deckTypes.length > 0) {
          try {
            rules.setDeckTypes(deckTypes);
          } catch (validationError) {
            console.info(
              `Invalid deck_is for object_id ${id}; falling back to defaults`,
              validationError
            );
          }
        }
        rules.SUB_DECKS = (result.sub_deck_is ?? '').split(',').filter(Boolean);
        rules.TAGS = result.tags_is;
        rules.EMAIL_NOTIFICATION = result.email_notification;
      } else {
        console.info(
          `No parser rules found for object_id: ${id} and owner: ${owner}. Using default values.`
        );
      }
      return rules;
    } catch (error) {
      console.error(error);
      return new ParserRules();
    }
  }
}

export default ParserRulesRepository;
