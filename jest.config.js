/** @type {import('ts-jest/dist/types').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/web/',
    '<rootDir>/.claude/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/test/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^puppeteer$': '<rootDir>/src/test/mocks/puppeteer.ts',
    '^metascraper$': '<rootDir>/src/test/mocks/metascraper.ts',
    '^metascraper-(description|image|logo-favicon|title|url)$':
      '<rootDir>/src/test/mocks/metascraperPlugin.ts',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/templates/**',
    '!src/migrations/**',
    '!src/test/fixtures/**',
    '!src/test/mocks/**',
    '!src/test/fakes/**',
    '!src/config/swagger.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
      },
    ],
    '^.+\\.jsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          allowJs: true,
          module: 'commonjs',
        },
      },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm/)?(archiver|is-stream|zip-stream|compress-commons|crc32-stream|p-limit|yocto-queue)(@|/))',
  ],
};
