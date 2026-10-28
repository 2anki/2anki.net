import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [full]
      : [];
  });
}

function callersOf(method: string): string[] {
  const call = new RegExp(String.raw`\.${method}\(`);
  return sourceFiles(SRC)
    .filter((file) => call.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file))
    .sort();
}

// A tripwire or Stripe alert sent through the AI-spend sender is logged and
// filed in SendGrid as an AI-spend alert, so a missing one is looked for in
// the wrong place (#5050).
describe('ops alert senders', () => {
  it('keeps the AI-spend sender for the AI spend guard alone', () => {
    expect(callersOf('sendAiSpendAlertEmail')).toEqual([
      path.join('lib', 'claude', 'aiSpendGuard.ts'),
    ]);
  });

  it('sends the tripwire, conversion stall and Stripe access alerts as ops alerts', () => {
    const server = fs.readFileSync(path.join(SRC, 'server.ts'), 'utf8');
    const stripe = fs.readFileSync(
      path.join(SRC, 'services', 'StripeAccessErrorReporter.ts'),
      'utf8'
    );

    expect(server).toMatch(/sendOpsAlertEmail\(\s*'metric-tripwire'/);
    expect(server).toMatch(/sendOpsAlertEmail\(\s*'conversion-stall'/);
    expect(stripe).toMatch(/sendOpsAlertEmail\(\s*'stripe-access'/);
  });
});
