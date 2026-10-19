import BlockHandler from '../../services/NotionService/BlockHandler/BlockHandler';
import ParserRules from '../../lib/parser/ParserRules';
import CardOption from '../../lib/parser/Settings';
import JobRepository from '../../data_layer/JobRepository';
import Deck from '../../lib/parser/Deck';

interface CreateFlashcardsForJobUseCaseInput {
  bl: BlockHandler;
  id: string;
  owner: string;
  rules: ParserRules;
  settings: CardOption;
  type?: string;
  frontField?: string;
  backField?: string;
}

export class CreateFlashcardsForJobUseCase {
  constructor(private readonly jobRepository: JobRepository) {}

  async execute(input: CreateFlashcardsForJobUseCaseInput): Promise<Deck[]> {
    const { bl, id, rules, settings, owner, type, frontField, backField } =
      input;
    const updateJobStatus = await this.jobRepository.updateJobStatus(
      id,
      owner,
      'step2_creating_flashcards',
      ''
    );

    if (!updateJobStatus) {
      throw new Error('Failed to update job status');
    }

    // Long database row-page walks bump this between rows so the stale-job
    // reclaim window cannot elapse mid-walk and dispatch a duplicate.
    bl.heartbeat = () =>
      this.jobRepository.updateJobStatus(
        id,
        owner,
        'step2_creating_flashcards',
        ''
      );

    return bl.findFlashcards({
      parentType: type ?? 'page',
      topLevelId: id.replace(/-/g, ''),
      rules,
      decks: [],
      parentName: settings.deckName || '',
      frontField,
      backField,
    });
  }
}
