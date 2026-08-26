import type { ISettingsRepository } from '../../data_layer/SettingsRepository';
import type { IConversionOutputStatsRepository } from '../../data_layer/ConversionOutputStatsRepository';
import type { IParsePathSignatureRepository } from '../../data_layer/ParsePathSignatureRepository';
import type { IConversionRuleScoresRepository } from '../../data_layer/ConversionRuleScoresRepository';
import type { ICardGuidLedgerRepository } from '../../data_layer/CardGuidLedgerRepository';
import type { PhotoToFlashcardsUseCase } from '../../usecases/imageOcclusion/PhotoToFlashcardsUseCase';

export type UploadServiceDeps = [
  ISettingsRepository,
  IConversionOutputStatsRepository,
  IParsePathSignatureRepository,
  IConversionRuleScoresRepository,
  ICardGuidLedgerRepository,
  PhotoToFlashcardsUseCase,
];

export interface UploadServiceDepOverrides {
  settings?: ISettingsRepository;
  outputStats?: IConversionOutputStatsRepository;
  parsePaths?: IParsePathSignatureRepository;
  ruleScores?: IConversionRuleScoresRepository;
  guidLedger?: ICardGuidLedgerRepository;
  photoToFlashcards?: PhotoToFlashcardsUseCase;
}

export function fakeUploadServiceDeps(
  overrides: UploadServiceDepOverrides = {}
): UploadServiceDeps {
  return [
    overrides.settings ??
      ({
        load: jest.fn(),
        loadIfExists: jest.fn().mockResolvedValue(null),
        attachCustomTemplates: jest.fn().mockResolvedValue(undefined),
        loadAnkifyTemplateOverrides: jest.fn().mockResolvedValue(null),
      } as unknown as ISettingsRepository),
    overrides.outputStats ?? {
      record: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
    },
    overrides.parsePaths ?? {
      record: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
    },
    overrides.ruleScores ?? {
      record: jest.fn().mockResolvedValue(undefined),
      distribution: jest.fn().mockResolvedValue([]),
    },
    overrides.guidLedger ?? {
      getAllForOwner: jest.fn().mockResolvedValue({}),
      record: jest.fn().mockResolvedValue(undefined),
      reissue: jest.fn().mockResolvedValue(undefined),
    },
    overrides.photoToFlashcards ??
      ({
        execute: jest
          .fn()
          .mockRejectedValue(
            new Error(
              'fakeUploadServiceDeps: pass photoToFlashcards to test image uploads'
            )
          ),
      } as unknown as PhotoToFlashcardsUseCase),
  ];
}
