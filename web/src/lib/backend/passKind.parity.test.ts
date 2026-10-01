import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function literals(block: string): string[] {
  return Array.from(block.matchAll(/'([a-z0-9]+)'/g), (m) => m[1]).sort();
}

function readServerPassKinds(): string[] {
  const source = readFileSync(
    join(__dirname, '../../../../', 'src/data_layer/UserPassRepository.ts'),
    'utf8'
  );
  const union = /export type PassKind =([^;]*);/.exec(source);
  if (union == null) {
    throw new Error('PassKind union not found in server source');
  }
  return literals(union[1]);
}

function readWebLocalsPassKinds(): string[] {
  const source = readFileSync(join(__dirname, 'getUserLocals.ts'), 'utf8');
  const field = /passKind\?:([^;]*);/.exec(source);
  if (field == null) {
    throw new Error('passKind field not found in getUserLocals');
  }
  return literals(field[1]);
}

describe('pass kind parity', () => {
  it('the locals response type lists exactly the server pass kinds', () => {
    const serverKinds = readServerPassKinds();
    expect(serverKinds.length).toBeGreaterThan(0);
    expect(readWebLocalsPassKinds()).toEqual(serverKinds);
  });
});
