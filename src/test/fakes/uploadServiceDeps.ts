import { vi } from 'vitest';
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
        load: vi.fn(),
        loadIfExists: vi.fn().mockResolvedValue(null),
        attachCustomTemplates: vi.fn().mockResolvedValue(undefined),
        loadAnkifyTemplateOverrides: vi.fn().mockResolvedValue(null),
      } as unknown as ISettingsRepository),
    overrides.outputStats ?? {
      record: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    },
    overrides.parsePaths ?? {
      record: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    },
    overrides.ruleScores ?? {
      record: vi.fn().mockResolvedValue(undefined),
      distribution: vi.fn().mockResolvedValue([]),
    },
    overrides.guidLedger ?? {
      getAllForOwner: vi.fn().mockResolvedValue({}),
      getUploadIdentityForOwner: vi.fn().mockResolvedValue({}),
      record: vi.fn().mockResolvedValue(undefined),
      reissue: vi.fn().mockResolvedValue(undefined),
    },
    overrides.aiFingerprints ?? {
      getRecentForOwner: vi.fn().mockResolvedValue([]),
      record: vi.fn().mockResolvedValue(undefined),
    },
    overrides.photoToFlashcards ??
      ({
        execute: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'fakeUploadServiceDeps: pass photoToFlashcards to test image uploads'
            )
          ),
      } as unknown as PhotoToFlashcardsUseCase),
    overrides.aiRequestCost ?? {
      costByRequestId: vi.fn().mockResolvedValue(0),
    },
    overrides.heldDeck ?? new InMemoryHeldDeckRepository(),
  ];
}
