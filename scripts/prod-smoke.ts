import { runDeploySmoke } from '../src/lib/deploySmoke/runDeploySmoke';

async function main(): Promise<number> {
  const baseUrl = process.argv[2]?.replace(/\/$/, '');
  if (baseUrl == null || baseUrl === '') {
    console.info('[smoke] FAILED: usage: tsx scripts/prod-smoke.ts <base-url>');
    return 2;
  }
  const started = Date.now();
  const { passed, failures } = await runDeploySmoke(baseUrl, fetch);
  for (const label of passed) {
    console.info(`[smoke] ok ${label}`);
  }
  for (const failure of failures) {
    console.info(`[smoke] FAIL ${failure}`);
  }
  const verdict = failures.length === 0 ? 'passed' : 'FAILED';
  console.info(
    `[smoke] ${verdict} against ${baseUrl}: ${passed.length} ok, ${failures.length} failing, ${Date.now() - started}ms`
  );
  return failures.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.info('[smoke] FAILED: the smoke script crashed', error);
    process.exit(1);
  }
);
