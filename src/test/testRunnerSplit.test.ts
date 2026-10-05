const jestConfig = require('../../jest.config.js') as {
  testPathIgnorePatterns: string[];
};

const ignoredByJest = (filePath: string): boolean =>
  jestConfig.testPathIgnorePatterns.some((pattern) =>
    new RegExp(pattern).test(filePath)
  );

const BASE = '/repo/src';

describe('jest testPathIgnorePatterns derived from test-runner-split.json', () => {
  it('hands migrated sql tests directly in data_layer to vitest', () => {
    expect(
      ignoredByJest(`${BASE}/data_layer/UsersRepository.resetToken.sql.test.ts`)
    ).toBe(true);
  });

  it('hands migrated sql tests nested one level deep to vitest', () => {
    expect(
      ignoredByJest(
        `${BASE}/data_layer/ankify/addContentHashToAnkifySyncMappingsMigration.sql.test.ts`
      )
    ).toBe(true);
  });

  it('hands migrated sql tests nested several levels deep to vitest', () => {
    expect(ignoredByJest(`${BASE}/data_layer/a/b/c/Deep.sql.test.ts`)).toBe(
      true
    );
  });

  it('keeps non-sql data_layer tests in jest', () => {
    expect(ignoredByJest(`${BASE}/data_layer/SettingsRepository.test.ts`)).toBe(
      false
    );
  });

  it('hands the whole lib/misc and controllers/helpers suites to vitest', () => {
    expect(ignoredByJest(`${BASE}/lib/misc/canAccess.test.ts`)).toBe(true);
    expect(
      ignoredByJest(`${BASE}/controllers/helpers/getRedirect.test.ts`)
    ).toBe(true);
  });

  it('keeps unrelated suites in jest', () => {
    expect(ignoredByJest(`${BASE}/lib/parser/DeckParser.test.ts`)).toBe(false);
  });
});
