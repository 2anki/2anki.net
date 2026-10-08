import JobRepository from '../../data_layer/JobRepository';
import { IUploadRepository } from '../../data_layer/UploadRespository';
import BlockHandler from '../../services/NotionService/BlockHandler/BlockHandler';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import Deck from '../../lib/parser/Deck';
import Workspace from '../../lib/parser/WorkSpace';
import CardOption from '../../lib/parser/Settings';
import StorageHandler from '../../lib/storage/StorageHandler';
import CardGenerator from '../../lib/anki/CardGenerator';
import fs from 'node:fs/promises';
import { toText } from '../../services/NotionService/BlockHandler/helpers/deckNameToText';
import {
  addDeckNameSuffix,
  DECK_NAME_SUFFIX,
  isValidDeckName,
} from '../../lib/anki/format';
import { FileSizeInMegaBytes } from '../../lib/misc/file';
import { getDatabase } from '../../data_layer';
import { EmptyDeckError } from './EmptyDeckError';

interface BuildDeckForJobUseCaseOutput {
  size: number;
  key: string;
  apkg: Buffer<ArrayBufferLike>;
}

interface BuildDeckForJobUseCaseInput {
  bl: BlockHandler;
  exporter: CustomExporter;
  decks: Deck[];
  ws: Workspace;
  settings: CardOption;
  storage: StorageHandler;
  id: string;
  owner: string;
  type?: string;
}

export class BuildDeckForJobUseCase {
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly uploadRepository: IUploadRepository
  ) {}

  async execute(
    input: BuildDeckForJobUseCaseInput
  ): Promise<BuildDeckForJobUseCaseOutput> {
    const { bl, exporter, decks, ws, settings, storage, id, owner, type } =
      input;
    await this.jobRepository.updateJobStatus(
      id,
      owner,
      'step3_building_deck',
      ''
    );

    const filteredDecks = decks.filter(
      (deck) => deck.cards && deck.cards.length > 0
    );

    if (filteredDecks.length === 0) {
      console.log('conversion.zero_cards', { id, owner, type });
      throw new EmptyDeckError(undefined, bl.emptyDeckReason());
    }

    const priorUploads = await this.uploadRepository.findAllByObjectIdAndOwner(
      id,
      Number(owner)
    );

    exporter.configure(filteredDecks);
    const gen = new CardGenerator(ws.location, id);
    const payload = (await gen.run()) as string;
    const apkg = await fs.readFile(payload);
    const filename = toText(
      (() => {
        const f = settings.deckName || bl.firstPageTitle || id;
        if (isValidDeckName(f)) {
          return f;
        }
        return addDeckNameSuffix(f);
      })()
    );

    const key = storage.uniqify(id, owner, 200, DECK_NAME_SUFFIX);
    await storage.uploadFile(key, apkg);
    const size = FileSizeInMegaBytes(payload);
    await getDatabase()('uploads').insert({
      object_id: id,
      owner,
      filename,
      key,
      size_mb: size,
    });

    for (const prior of priorUploads) {
      try {
        await storage.delete(prior.key);
        await this.uploadRepository.deleteUpload(prior.owner, prior.key);
      } catch (err) {
        console.error('[BuildDeckForJobUseCase] prune prior upload failed', {
          object_id: id,
          owner,
          key: prior.key,
          err,
        });
      }
    }

    return { size, key, apkg };
  }
}
