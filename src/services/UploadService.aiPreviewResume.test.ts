import fs from 'node:fs';
import path from 'node:path';

import UploadService from './UploadService';
import { AiCreditsExhaustedError } from '../lib/claude/aiSpendGuard';
import { AI_CREDITS_EXHAUSTED_WARNING_CODE } from '../lib/claude/aiCredits/uploadWarning';
import type { ConversionEngine } from '../lib/parser/conversionEngine';
import type Package from '../lib/parser/Package';
import type { UploadedFile } from '../lib/storage/types';
import type { IUploadRepository } from '../data_layer/UploadRespository';
import type JobRepository from '../data_layer/JobRepository';
import type UsersRepository from '../data_layer/UsersRepository';
import type { UploadGenerationTask } from '../usecases/uploads/uploadGenerationTypes';
import { fakeUploadServiceDeps } from '../test/fakes/uploadServiceDeps';

const workerResult = vi.hoisted(() => ({
  engine: 'claude' as ConversionEngine,
  warnings: [] as string[],
}));

vi.mock('../lib/conversionPool', async (importActual) => {
  const actual = await importActual<typeof import('../lib/conversionPool')>();
  return {
    ...actual,
    runUploadGeneration: async (task: UploadGenerationTask) => {
      fs.writeFileSync(
        path.join(task.workspace.location, 'notes.apkg'),
        'APKG'
      );
      return {
        ok: true,
        packages: [
          {
            name: 'notes.apkg',
            cardCount: 3,
            engine: workerResult.engine,
          } as unknown as Package,
        ],
        warnings: workerResult.warnings,
      };
    },
  };
});

function heldFile(): UploadedFile {
  return {
    originalname: 'notes.html',
    size: 13,
    buffer: Buffer.from('<html></html>'),
  } as unknown as UploadedFile;
}

function service(): UploadService {
  return new UploadService(
    {} as IUploadRepository,
    {} as JobRepository,
    {} as UsersRepository,
    ...fakeUploadServiceDeps({})
  );
}

describe('UploadService.convertStoredFileWithAiForPass on spent credits', () => {
  it('refuses a deck the conversion built without AI', async () => {
    workerResult.engine = 'parser';
    workerResult.warnings = [AI_CREDITS_EXHAUSTED_WARNING_CODE];

    await expect(
      service().convertStoredFileWithAiForPass(7, heldFile(), 'req-1')
    ).rejects.toBeInstanceOf(AiCreditsExhaustedError);
  });

  it('ships the AI cards made before the guard stopped the run', async () => {
    workerResult.engine = 'claude';
    workerResult.warnings = [AI_CREDITS_EXHAUSTED_WARNING_CODE];

    const conversion = await service().convertStoredFileWithAiForPass(
      7,
      heldFile(),
      'req-1'
    );

    expect(conversion).toEqual({
      apkg: Buffer.from('APKG'),
      cardCount: 3,
      deckName: 'notes.apkg',
    });
  });

  it('ships a parser deck that carries no credits warning', async () => {
    workerResult.engine = 'parser';
    workerResult.warnings = [];

    const conversion = await service().convertStoredFileWithAiForPass(
      7,
      heldFile(),
      'req-1'
    );

    expect(conversion.cardCount).toBe(3);
  });
});
