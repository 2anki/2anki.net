import { getDatabase } from '../../data_layer';
import addHeadings from './helpers/addHeadings';

class ParserRules {
  static readonly DECK_TYPE_ALLOWLIST: readonly string[] = [
    'page',
    'database',
    'child_page',
    'child_database',
    'toggle',
    'heading_1',
    'heading_2',
    'heading_3',
    'bulleted_list_item',
    'numbered_list_item',
    'quote',
    'column_list',
  ];

  static readonly FLASHCARD_TYPE_ALLOWLIST: readonly string[] = [
    'paragraph',
    'callout',
    'quote',
    'code',
    'toggle',
    'to_do',
    'bulleted_list_item',
    'numbered_list_item',
    'column_list',
    'table',
    'heading_1',
    'heading_2',
    'heading_3',
  ];

  private FLASHCARD = ['toggle'];

  DECK = ['page', 'database'];

  SUB_DECKS = ['child_page'];

  TAGS = 'strikethrough';

  EMAIL_NOTIFICATION = false;

  /**
   *  Function to handle transforming flaschard types to proper names for use in traversal
   * @returns all type names for flashcards
   */
  flaschardTypeNames(): string[] {
    let names = this.FLASHCARD;
    names = addHeadings(names);
    return names;
  }

  /**
   * Setter for the types to prevent direct access
   * @param types string[]
   */
  setFlashcardTypes(types: string[]) {
    this.FLASHCARD = types;
  }

  setDeckTypes(types: string[]) {
    if (!Array.isArray(types) || types.length === 0) {
      throw new Error('setDeckTypes: at least one deck type is required');
    }
    const unknown = types.filter(
      (t) => !ParserRules.DECK_TYPE_ALLOWLIST.includes(t)
    );
    if (unknown.length > 0) {
      throw new Error(
        `setDeckTypes: unsupported deck types: ${unknown.join(', ')}`
      );
    }
    const seen = new Set<string>();
    this.DECK = types.filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  }

  /**
   *  return the flashcard types
   * @returns string[]
   */
  flashcardTypes(): string[] {
    return this.FLASHCARD;
  }

  deckTypes(): string[] {
    return this.DECK;
  }

  /**
   * Backwards-compatible convenience for callers that don't have a
   * `ParserRulesRepository` instance. New code should inject the repo
   * directly (see `src/usecases/jobs/CreateJobWorkSpaceUseCase.ts`).
   */
  static async Load(owner: string, id: string): Promise<ParserRules> {
    // Local import to avoid a circular dependency between the parser
    // domain class and the data-layer.
    const { default: ParserRulesRepository } =
      await import('../../data_layer/ParserRulesRepository');
    const repo = new ParserRulesRepository(getDatabase());
    return repo.load(owner, id);
  }

  useColums() {
    return this.FLASHCARD.includes('column_list');
  }

  permitsDeckAsPage(): boolean {
    return this.DECK.includes('page');
  }
}

export default ParserRules;
