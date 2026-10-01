import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STRUCTURE_RESCUE_RULES } from './parseStructureRescuedPayload';

function readServerCandidateRules(): string[] {
  const source = readFileSync(
    join(
      __dirname,
      '../../../../../',
      'src/lib/parser/induction/candidateRules.ts'
    ),
    'utf8'
  );
  const block =
    /const CANDIDATE_ORDER: readonly InducedRule\[\] = \[([\s\S]*?)\]/.exec(
      source
    );
  if (block == null) {
    throw new Error('CANDIDATE_ORDER not found in server source');
  }
  return Array.from(block[1].matchAll(/'([a-z]+)'/g), (m) => m[1]);
}

describe('structure rescue rule parity', () => {
  it('the web rule names match the server candidate set (order aside)', () => {
    const serverRules = readServerCandidateRules();
    expect([...STRUCTURE_RESCUE_RULES].sort()).toEqual([...serverRules].sort());
  });
});
