import type Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { logClaudeUsage } from '../../../lib/claude/logClaudeUsage';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
// A cap, not a charge — output is billed on tokens actually generated, so a
// generous ceiling costs nothing on documents that were never near it. At the
// old 8192 a dense multi-page PDF hit the cap routinely, and the truncation
// went unchecked, so the user received the front of their document as if it
// were the whole thing.
const MAX_TOKENS = 32768;

export const CONVERSION_TRUNCATED_MESSAGE =
  'This document is too large to convert in one pass. Split it into smaller parts and convert each one.';

// Silent truncation is the worst outcome: the output parses, the deck builds,
// and the user has no signal that the tail of their document is missing. An
// error they can act on beats half a deck they cannot detect.
function assertNotTruncated(stopReason: string | null | undefined): void {
  if (stopReason === 'max_tokens') {
    throw new FileConversionError(CONVERSION_TRUNCATED_MESSAGE);
  }
}

function joinTextBlocks(content: { type: string; text?: string }[]): string {
  return content
    .filter(
      (block): block is { type: 'text'; text: string } => block.type === 'text'
    )
    .map((block) => block.text)
    .join('');
}

export class FileConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileConversionError';
  }
}

interface ConvertOptions {
  pdf?: boolean;
}

function getModel(): string {
  return process.env.CLAUDE_FILE_CONVERSION_MODEL ?? DEFAULT_MODEL;
}

export async function convertWithClaude(
  client: Anthropic,
  systemPrompt: string,
  userContent: Anthropic.ContentBlockParam[],
  options: ConvertOptions = {}
): Promise<string> {
  const systemBlock: Anthropic.Beta.BetaTextBlockParam & {
    cache_control: { type: 'ephemeral' };
  } = {
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' },
  };

  try {
    if (options.pdf) {
      const response = await client.beta.messages.create({
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system: [systemBlock],
        messages: [
          { role: 'user', content: userContent as BetaContentBlockParam[] },
        ],
        betas: ['pdfs-2024-09-25'],
      });
      logClaudeUsage('claudeFileConversion', response.usage);
      assertNotTruncated(response.stop_reason);
      return joinTextBlocks(response.content);
    }

    const response = await client.messages.create({
      model: getModel(),
      max_tokens: MAX_TOKENS,
      system: [systemBlock],
      messages: [{ role: 'user', content: userContent }],
    });
    logClaudeUsage('claudeFileConversion', response.usage);
    assertNotTruncated(response.stop_reason);
    return joinTextBlocks(response.content);
  } catch (error) {
    if (error instanceof FileConversionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new FileConversionError(message);
  }
}
