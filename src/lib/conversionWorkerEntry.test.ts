import { resolveConversionWorkerEntry } from './conversionWorkerEntry';

describe('resolveConversionWorkerEntry', () => {
  it('runs the compiled worker without tsx when the server runs from .js', () => {
    expect(
      resolveConversionWorkerEntry('/srv/app/src/lib/conversionPool.js')
    ).toEqual({
      filename: '/srv/app/src/lib/conversionWorker.js',
      execArgv: [],
    });
  });

  it('loads the TypeScript worker through tsx when running from source', () => {
    expect(
      resolveConversionWorkerEntry('/repo/src/lib/conversionPool.ts')
    ).toEqual({
      filename: '/repo/src/lib/conversionWorker.ts',
      execArgv: ['--require', 'tsx/cjs'],
    });
  });
});
