import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_USER_INSTRUCTIONS,
  INSTRUCTION_PRESETS,
} from './CardOptionsForm';

function readServerDefaultInstructions(): string {
  const serverSource = readFileSync(
    join(
      __dirname,
      '../../../../src/infrastracture/adapters/fileConversion/convertPDFToHTML.ts'
    ),
    'utf8'
  );
  const match = serverSource.match(
    /const DEFAULT_PDF_TO_HTML_INSTRUCTIONS = `([\s\S]*?)`;/
  );
  if (!match) {
    throw new Error(
      'DEFAULT_PDF_TO_HTML_INSTRUCTIONS not found in convertPDFToHTML.ts'
    );
  }
  return match[1];
}

describe('web/server default user instructions parity', () => {
  it('matches the server default so a chip tap never freezes a drifted copy', () => {
    expect(DEFAULT_USER_INSTRUCTIONS.trim()).toEqual(
      readServerDefaultInstructions().trim()
    );
  });
});

describe('instruction preset sentence versioning', () => {
  it('pins the exact sentences so a reword forces a stored-copy migration map', () => {
    expect(INSTRUCTION_PRESETS.map((preset) => preset.sentence)).toEqual([
      "Write multiple-choice questions. Put the question and all answer options (A, B, C, D) on the front of the card; put only the correct option's letter on the back.",
      'Make a separate card for each list item instead of grouping a list onto one card.',
    ]);
  });
});
