import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

const split = JSON.parse(
  readFileSync(resolve(rootDir, 'test-runner-split.json'), 'utf8')
) as { vitest: string[]; jestOnly?: string[] };

const mockPath = (relativePath: string) => resolve(rootDir, relativePath);

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    pool: 'forks',
    isolate: true,
    include: split.vitest,
    exclude: [
      '**/node_modules/**',
      'web/**',
      '.claude/**',
      'test/**',
      ...(split.jestOnly ?? []),
    ],
    setupFiles: ['src/test/vitest.setup.ts'],
    testTimeout: 5000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/templates/**',
        'src/migrations/**',
        'src/test/fixtures/**',
        'src/test/mocks/**',
        'src/test/fakes/**',
        'src/config/swagger.ts',
      ],
    },
  },
  resolve: {
    alias: [
      {
        find: /^pdf-parse$/,
        replacement: 'pdf-parse/lib/pdf-parse.js',
      },
      {
        find: /^puppeteer$/,
        replacement: mockPath('src/test/mocks/puppeteer.ts'),
      },
      {
        find: /^metascraper$/,
        replacement: mockPath('src/test/mocks/metascraper.ts'),
      },
      {
        find: /^metascraper-(description|image|logo-favicon|title|url)$/,
        replacement: mockPath('src/test/mocks/metascraperPlugin.ts'),
      },
    ],
  },
});
