import type { ISettingsRepository } from '../../data_layer/SettingsRepository';
import type { IConversionOutputStatsRepository } from '../../data_layer/ConversionOutputStatsRepository';
import type { IParsePathSignatureRepository } from '../../data_layer/ParsePathSignatureRepository';
import type { IConversionRuleScoresRepository } from '../../data_layer/ConversionRuleScoresRepository';
import type { ICardGuidLedgerRepository } from '../../data_layer/CardGuidLedgerRepository';
import type { IAiCardFingerprintRepository } from '../../data_layer/AiCardFingerprintRepository';
import type { IAiRequestCostReader } from '../../data_layer/AiUsageMetricsRepository';
import type { PhotoToFlashcardsUseCase } from '../../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import {
  InMemoryHeldDeckRepository,
  type IHeldDeckRepository,
} from '../../data_layer/HeldDeckRepository';

const mocker =
  (globalThis as typeof globalThis & { vi?: typeof jest }).vi ?? jest;

export type UploadServiceDeps = [
  ISettingsRepository,
  IConversionOutputStatsRepository,
  IParsePathSignatureRepository,
  IConversionRuleScoresRepository,
  ICardGuidLedgerRepository,
  IAiCardFingerprintRepository,
  PhotoToFlashcardsUseCase,
  IAiRequestCostReader,
  IHeldDeckRepository,
];

export interface UploadServiceDepOverrides {
  settings?: ISettingsRepository;
  outputStats?: IConversionOutputStatsRepository;
  parsePaths?: IParsePathSignatureRepository;
  ruleScores?: IConversionRuleScoresRepository;
  guidLedger?: ICardGuidLedgerRepository;
  aiFingerprints?: IAiCardFingerprintRepository;
  photoToFlashcards?: PhotoToFlashcardsUseCase;
  aiRequestCost?: IAiRequestCostReader;
  heldDeck?: IHeldDeckRepository;
}

export function fakeUploadServiceDeps(
  overrides: UploadServiceDepOverrides = {}
): UploadServiceDeps {
  return [
    overrides.settings ??
      ({
        load: mocker.fn(),
        loadIfExists: mocker.fn().mockResolvedValue(null),
        attachCustomTemplates: mocker.fn().mockResolvedValue(undefined),
        loadAnkifyTemplateOverrides: mocker.fn().mockResolvedValue(null),
      } as unknown as ISettingsRepository),
    overrides.outputStats ?? {
      record: mocker.fn().mockResolvedValue(undefined),
      list: mocker.fn().mockResolvedValue([]),
    },
    overrides.parsePaths ?? {
      record: mocker.fn().mockResolvedValue(undefined),
      list: mocker.fn().mockResolvedValue([]),
    },
    overrides.ruleScores ?? {
      record: mocker.fn().mockResolvedValue(undefined),
      distribution: mocker.fn().mockResolvedValue([]),
    },
    overrides.guidLedger ?? {
      getAllForOwner: mocker.fn().mockResolvedValue({}),
      getUploadIdentityForOwner: mocker.fn().mockResolvedValue({}),
      record: mocker.fn().mockResolvedValue(undefined),
      reissue: mocker.fn().mockResolvedValue(undefined),
    },
    overrides.aiFingerprints ?? {
      getRecentForOwner: mocker.fn().mockResolvedValue([]),
      record: mocker.fn().mockResolvedValue(undefined),
    },
    overrides.photoToFlashcards ??
      ({
        execute: mocker
          .fn()
          .mockRejectedValue(
            new Error(
              'fakeUploadServiceDeps: pass photoToFlashcards to test image uploads'
            )
          ),
      } as unknown as PhotoToFlashcardsUseCase),
    overrides.aiRequestCost ?? {
      costByRequestId: mocker.fn().mockResolvedValue(0),
    },
    overrides.heldDeck ?? new InMemoryHeldDeckRepository(),
  ];
}
