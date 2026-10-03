import CardOption from '../../lib/parser/Settings';
import Workspace from '../../lib/parser/WorkSpace';
import { UploadedFile } from '../../lib/storage/types';
import { toText } from '../../services/NotionService/BlockHandler/helpers/deckNameToText';
import GeneratePackagesUseCase from './GeneratePackagesUseCase';
import {
  SAMPLE_DECK_FILENAME,
  SAMPLE_DECK_HTML,
  SAMPLE_DECK_NAME,
} from '../../lib/upload/sampleDeck';

export interface SampleDeck {
  apkg: Buffer;
  cardCount: number;
  deckName: string;
}

function buildSampleUpload(): UploadedFile {
  const buffer = Buffer.from(SAMPLE_DECK_HTML, 'utf-8');
  return {
    fieldname: 'pakker',
    originalname: SAMPLE_DECK_FILENAME,
    encoding: '7bit',
    mimetype: 'text/html',
    size: buffer.byteLength,
    buffer,
    key: SAMPLE_DECK_FILENAME,
    destination: '',
    filename: SAMPLE_DECK_FILENAME,
    path: '',
    stream: undefined as never,
  };
}

export class ConvertSampleDeckUseCase {
  private cached: Promise<SampleDeck> | null = null;

  constructor(
    private readonly generatePackages = new GeneratePackagesUseCase()
  ) {}

  execute(): Promise<SampleDeck> {
    if (this.cached == null) {
      this.cached = this.convert();
      this.cached.catch(() => {
        this.cached = null;
      });
    }
    return this.cached;
  }

  private async convert(): Promise<SampleDeck> {
    const workspace = new Workspace(true, 'fs');
    const { packages } = await this.generatePackages.execute(
      false,
      [buildSampleUpload()],
      new CardOption({}),
      workspace
    );
    const apkg = await workspace.getFirstAPKG();
    if (apkg == null) {
      throw new Error('Sample deck produced no APKG');
    }
    const cardCount = packages.reduce((sum, p) => sum + (p.cardCount ?? 0), 0);
    const deckName = packages[0] ? toText(packages[0].name) : SAMPLE_DECK_NAME;
    return { apkg, cardCount, deckName };
  }
}

export default ConvertSampleDeckUseCase;
