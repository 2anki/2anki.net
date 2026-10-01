import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function num(source: string, name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(source);
  if (match == null) {
    throw new Error(`${name} not found`);
  }
  return Number.parseInt(match[1], 10);
}

function readRoot(relativePath: string): string {
  return readFileSync(join(__dirname, '../../../../', relativePath), 'utf8');
}

function readWeb(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf8');
}

const serverSource = readRoot(
  'src/usecases/users/CheckMonthlyCardLimitUseCase.ts'
);

describe('free-tier limit parity', () => {
  it('the free monthly card cap matches the server', () => {
    const web = num(readWeb('LimitWall.tsx'), 'FREE_MONTHLY_CARDS');
    expect(web).toBe(num(serverSource, 'MONTHLY_CARD_LIMIT'));
  });

  it('the anonymous conversion cap matches the server', () => {
    const web = num(readWeb('LimitPage.tsx'), 'ANONYMOUS_CARD_CAP');
    expect(web).toBe(num(serverSource, 'ANONYMOUS_CARD_CAP'));
  });
});
