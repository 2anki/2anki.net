import fs from 'node:fs';
import NotionAPIWrapper from '../../services/NotionService/NotionAPIWrapper';
import JobRepository from '../../data_layer/JobRepository';
import { ISettingsRepository } from '../../data_layer/SettingsRepository';
import { IParserRulesRepository } from '../../data_layer/ParserRulesRepository';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import CardOption from '../../lib/parser/Settings';
import BlockHandler from '../../services/NotionService/BlockHandler/BlockHandler';
import ParserRules from '../../lib/parser/ParserRules';
import Workspace from '../../lib/parser/WorkSpace';

export interface CreateJobWorkSpaceUseCaseInput {
  id: string;
  owner: string;
  api: NotionAPIWrapper;
  jobRepository: JobRepository;
  isPaying: boolean;
}

export interface CreateJobWorkSpaceUseCaseOutput {
  ws: Workspace;
  exporter: CustomExporter;
  settings: CardOption;
  bl: BlockHandler;
  rules: ParserRules;
}

export class CreateJobWorkSpaceUseCase {
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly settingsRepository: ISettingsRepository,
    private readonly parserRulesRepository: IParserRulesRepository
  ) {}

  async execute(
    input: CreateJobWorkSpaceUseCaseInput
  ): Promise<CreateJobWorkSpaceUseCaseOutput> {
    const updateStatusResult = await this.jobRepository.updateJobStatus(
      input.id,
      input.owner,
      'step1_create_workspace',
      ''
    );

    if (!updateStatusResult) {
      throw new Error('Failed to update job status');
    }

    const { id, owner, api } = input;

    const ws = new Workspace(true, 'fs');
    console.debug(`using workspace ${ws.location}`);

    try {
      const exporter = new CustomExporter('', ws.location);
      const settings = await this.settingsRepository.load(owner, id);
      console.debug(`using settings ${JSON.stringify(settings, null, 2)}`);

      const bl = new BlockHandler(
        exporter,
        api,
        settings,
        this.settingsRepository,
        owner
      );
      const rules = await this.parserRulesRepository.load(owner, id);
      bl.useAll = input.isPaying;

      return { ws, exporter, settings, bl, rules };
    } catch (error) {
      fs.rmSync(ws.location, { recursive: true, force: true });
      throw error;
    }
  }
}
