import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CreateJobWorkSpaceUseCase } from './CreateJobWorkSpaceUseCase';
import JobRepository from '../../data_layer/JobRepository';
import { ISettingsRepository } from '../../data_layer/SettingsRepository';
import { IParserRulesRepository } from '../../data_layer/ParserRulesRepository';
import CardOption from '../../lib/parser/Settings';
import ParserRules from '../../lib/parser/ParserRules';

beforeAll(() => {
  process.env.WORKSPACE_BASE = '/tmp/test-workspace';
});

describe('CreateJobWorkSpaceUseCase', () => {
  const jobRepository = {
    updateJobStatus: jest.fn().mockResolvedValue(true),
  } as unknown as JobRepository;

  const settingsRepository: ISettingsRepository = {
    load: jest
      .fn()
      .mockResolvedValue(new CardOption(CardOption.LoadDefaultOptions())),
    loadIfExists: jest
      .fn()
      .mockResolvedValue(new CardOption(CardOption.LoadDefaultOptions())),
    loadAnkifyTemplateOverrides: jest.fn().mockResolvedValue(null),
    attachCustomTemplates: jest.fn().mockResolvedValue(undefined),
  };

  const parserRulesRepository: IParserRulesRepository = {
    load: jest.fn().mockResolvedValue(new ParserRules()),
  };

  const mockApi = {} as never;

  function makeUseCase() {
    return new CreateJobWorkSpaceUseCase(
      jobRepository,
      settingsRepository,
      parserRulesRepository
    );
  }

  it('sets useAll to true when isPaying is true', async () => {
    const useCase = makeUseCase();
    const result = await useCase.execute({
      id: 'test-id',
      owner: 'test-owner',
      api: mockApi,
      jobRepository,
      isPaying: true,
    });
    expect(result.bl.useAll).toBe(true);
  });

  it('sets useAll to false when isPaying is false', async () => {
    const useCase = makeUseCase();
    const result = await useCase.execute({
      id: 'test-id',
      owner: 'test-owner',
      api: mockApi,
      jobRepository,
      isPaying: false,
    });
    expect(result.bl.useAll).toBe(false);
  });

  it('loads settings and rules from the injected repositories', async () => {
    const useCase = makeUseCase();
    await useCase.execute({
      id: 'page-42',
      owner: 'user-7',
      api: mockApi,
      jobRepository,
      isPaying: false,
    });
    expect(settingsRepository.load).toHaveBeenCalledWith('user-7', 'page-42');
    expect(parserRulesRepository.load).toHaveBeenCalledWith(
      'user-7',
      'page-42'
    );
  });

  it('removes the created workspace directory when settings load rejects', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cjws-orphan-'));
    const previousBase = process.env.WORKSPACE_BASE;
    process.env.WORKSPACE_BASE = base;
    const rejectingSettings: ISettingsRepository = {
      ...settingsRepository,
      load: jest.fn().mockRejectedValue(new Error('settings db down')),
    };
    const useCase = new CreateJobWorkSpaceUseCase(
      jobRepository,
      rejectingSettings,
      parserRulesRepository
    );

    await expect(
      useCase.execute({
        id: 'orphan-page',
        owner: 'orphan-owner',
        api: mockApi,
        jobRepository,
        isPaying: false,
      })
    ).rejects.toThrow('settings db down');

    expect(fs.readdirSync(base)).toEqual([]);

    process.env.WORKSPACE_BASE = previousBase;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('throws when the job-status update fails', async () => {
    const failingJobRepo = {
      updateJobStatus: jest.fn().mockResolvedValue(false),
    } as unknown as JobRepository;
    const useCase = new CreateJobWorkSpaceUseCase(
      failingJobRepo,
      settingsRepository,
      parserRulesRepository
    );
    await expect(
      useCase.execute({
        id: 'x',
        owner: 'y',
        api: mockApi,
        jobRepository: failingJobRepo,
        isPaying: false,
      })
    ).rejects.toThrow(/Failed to update job status/);
  });
});
