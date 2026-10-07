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

  it('keeps lib subtrees still owned by later phases in jest', () => {
    expect(ignoredByJest(`${BASE}/lib/parser/DeckParser.test.ts`)).toBe(false);
    expect(ignoredByJest(`${BASE}/lib/claude/ClaudeService.test.ts`)).toBe(
      false
    );
    expect(ignoredByJest(`${BASE}/lib/pdf/getPageCount.test.ts`)).toBe(false);
    expect(
      ignoredByJest(`${BASE}/lib/notion-render/highlightCode.test.ts`)
    ).toBe(false);
  });

  it('keeps services suites in jest but hands usecases to vitest (phase 3 widened the glob)', () => {
    expect(
      ignoredByJest(
        `${BASE}/services/NotionService/BlockHandler/BlockHandler.test.ts`
      )
    ).toBe(false);
    expect(
      ignoredByJest(`${BASE}/usecases/uploads/GeneratePackagesUseCase.test.ts`)
    ).toBe(true);
  });
});
