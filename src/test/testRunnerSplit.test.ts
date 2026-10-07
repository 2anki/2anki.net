const jestConfig = require('../../jest.config.js') as {
  testPathIgnorePatterns: string[];
};

const ignoredByJest = (filePath: string): boolean =>
  jestConfig.testPathIgnorePatterns.some((pattern) =>
    new RegExp(pattern).test(filePath)
  );

const BASE = '/repo/src';

describe('jest testPathIgnorePatterns derived from test-runner-split.json', () => {
  it('hands non-sql data_layer suites to vitest (phase 2 widened the glob)', () => {
    expect(ignoredByJest(`${BASE}/data_layer/SettingsRepository.test.ts`)).toBe(
      true
    );
  });

  it('keeps handing sql and nested data_layer suites to vitest', () => {
    expect(
      ignoredByJest(`${BASE}/data_layer/UsersRepository.resetToken.sql.test.ts`)
    ).toBe(true);
    expect(
      ignoredByJest(
        `${BASE}/data_layer/ankify/AnkifySyncMappingsRepository.test.ts`
      )
    ).toBe(true);
  });

  it('hands lib top-level suites to vitest without reaching into subdirectories', () => {
    expect(ignoredByJest(`${BASE}/lib/config.test.ts`)).toBe(true);
    expect(ignoredByJest(`${BASE}/lib/conversionPool.test.ts`)).toBe(true);
  });

  it('hands migrated lib subtrees and the phase-1 suites to vitest', () => {
    expect(ignoredByJest(`${BASE}/lib/misc/canAccess.test.ts`)).toBe(true);
    expect(
      ignoredByJest(`${BASE}/lib/storage/jobs/helpers/deleteOldUploads.test.ts`)
    ).toBe(true);
    expect(
      ignoredByJest(`${BASE}/controllers/helpers/getRedirect.test.ts`)
    ).toBe(true);
  });

  it('hands parser, claude, pdf and notion-render suites to vitest (phase 5)', () => {
    expect(ignoredByJest(`${BASE}/lib/parser/DeckParser.test.ts`)).toBe(true);
    expect(ignoredByJest(`${BASE}/lib/claude/ClaudeService.test.ts`)).toBe(
      true
    );
    expect(ignoredByJest(`${BASE}/lib/pdf/getPageCount.test.ts`)).toBe(true);
    expect(
      ignoredByJest(`${BASE}/lib/notion-render/highlightCode.test.ts`)
    ).toBe(true);
  });

  it('keeps controllers and routes suites in jest (owned by a later phase)', () => {
    expect(ignoredByJest(`${BASE}/controllers/JobController.test.ts`)).toBe(
      false
    );
    expect(ignoredByJest(`${BASE}/routes/OpsErrorsRouter.test.ts`)).toBe(false);
  });

  it('hands services and infrastracture suites to vitest (phase 4)', () => {
    expect(ignoredByJest(`${BASE}/services/UploadService.test.ts`)).toBe(true);
    expect(
      ignoredByJest(`${BASE}/services/NotionService/blocks/BlockCode.test.tsx`)
    ).toBe(true);
    expect(
      ignoredByJest(
        `${BASE}/infrastracture/adapters/fileConversion/PrepareDeck.test.ts`
      )
    ).toBe(true);
  });

  it('hands usecases suites to vitest (phase 3)', () => {
    expect(
      ignoredByJest(`${BASE}/usecases/uploads/GeneratePackagesUseCase.test.ts`)
    ).toBe(true);
  });

  it('keeps the jestOnly BlockHandler suite in jest (phase 4 carve-out)', () => {
    expect(
      ignoredByJest(
        `${BASE}/services/NotionService/BlockHandler/BlockHandler.test.ts`
      )
    ).toBe(false);
  });
});
