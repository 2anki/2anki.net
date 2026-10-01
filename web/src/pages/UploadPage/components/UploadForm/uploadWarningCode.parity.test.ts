import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_CREDITS_WARNING_CODE } from './uploadResponse';

function readServerAiCreditsWarningCode(): string {
  const source = readFileSync(
    join(
      __dirname,
      '../../../../../../',
      'src/lib/claude/aiCredits/uploadWarning.ts'
    ),
    'utf8'
  );
  const match = /AI_CREDITS_EXHAUSTED_WARNING_CODE = '([a-z-]+)'/.exec(source);
  if (match == null) {
    throw new Error('AI_CREDITS_EXHAUSTED_WARNING_CODE not found in server source');
  }
  return match[1];
}

describe('AI credits warning code parity', () => {
  it('the web warning code the X-Warning-Code header is matched against equals the server value', () => {
    expect(AI_CREDITS_WARNING_CODE).toBe(readServerAiCreditsWarningCode());
  });
});
