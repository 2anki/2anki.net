import { getAnthropicClient } from '../../lib/claude/ClaudeService';
import { logClaudeUsage } from '../../lib/claude/logClaudeUsage';

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 8192;

export interface AnkiCardTemplateInput {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
}

export interface AnkiNoteFieldInput {
  name: string;
  ord: number;
}

export interface AnkiNoteTypeInput {
  id?: number;
  name: string;
  type: 0 | 1;
  tmpls: AnkiCardTemplateInput[];
  flds: AnkiNoteFieldInput[];
  css: string;
}

export interface NoteTypeStarterInput {
  id?: string;
  name: string;
  description: string;
  baseType: 'basic' | 'cloze';
  noteType: AnkiNoteTypeInput;
  previewData: Record<string, string>;
  tags?: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIGenerateResult {
  starter: NoteTypeStarterInput;
  reply: string;
}

const SYSTEM_PROMPT = `You design Anki note types for the 2anki.net app. 2anki turns Notion pages into Anki flashcards, so the user's note types need to work both in Anki and as a target for 2anki's conversion pipeline.

The user describes what they want. You respond with a single JSON object — nothing else — wrapped in a fenced \`\`\`json code block. The object has this shape:

{
  "reply": "One short sentence naming what you changed (e.g. 'Switched the body font to serif.'). If you cannot apply the requested change, or you return the same starter unmodified, write exactly: 'No changes made.'",
  "starter": {
    "name": "Short user-facing name",
    "description": "One sentence describing when to use it",
    "baseType": "basic" | "cloze",
    "noteType": {
      "name": "Internal model name — usually same as name",
      "type": 0 | 1,
      "tmpls": [
        { "name": "Card 1", "ord": 0, "qfmt": "<html for front>", "afmt": "<html for back>" }
      ],
      "flds": [
        { "name": "Front", "ord": 0 },
        { "name": "Back", "ord": 1 }
      ],
      "css": "/* CSS scoped to .card */"
    },
    "previewData": {
      "Front": "example value",
      "Back": "example value"
    },
    "tags": []
  }
}

Rules:
- noteType.type is 0 for Basic, 1 for Cloze.
- Cloze templates must use Anki's {{cloze:FieldName}} syntax in qfmt/afmt and at least one field that contains {{c1::...}} markers in previewData.
- Basic templates may reference {{FieldName}} and {{FrontSide}}.
- Field "ord" values must be 0..N-1 and match their position in the array.
- CSS targets .card (Anki's wrapper). Use realistic colours, web-safe fonts, modest sizes — looks should hold up at preview sizes around 800x450.
- previewData covers every field in flds and shows a single example card the user would recognize.
- Always return valid JSON. No comments, no trailing commas. No prose outside the fenced block.`;

const FENCE_OPEN = '```json';
const FENCE_CLOSE = '```';

function findFencedJson(text: string): string | null {
  const lower = text.toLowerCase();
  const openIndex = lower.indexOf(FENCE_OPEN);
  if (openIndex === -1) return null;
  let contentStart = openIndex + FENCE_OPEN.length;
  while (
    contentStart < text.length &&
    (text[contentStart] === ' ' ||
      text[contentStart] === '\t' ||
      text[contentStart] === '\r' ||
      text[contentStart] === '\n')
  ) {
    contentStart += 1;
  }
  const closeIndex = text.indexOf(FENCE_CLOSE, contentStart);
  if (closeIndex === -1) return null;
  return text.slice(contentStart, closeIndex).trim();
}

interface ScanState {
  depth: number;
  inString: boolean;
  escape: boolean;
  done: boolean;
}

function advance(state: ScanState, char: string): ScanState {
  if (state.escape) return { ...state, escape: false };
  if (state.inString) {
    if (char === '\\') return { ...state, escape: true };
    if (char === '"') return { ...state, inString: false };
    return state;
  }
  if (char === '"') return { ...state, inString: true };
  if (char === '{') return { ...state, depth: state.depth + 1 };
  if (char === '}') {
    const depth = state.depth - 1;
    return { ...state, depth, done: depth === 0 };
  }
  return state;
}

function findBareJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let state: ScanState = {
    depth: 0,
    inString: false,
    escape: false,
    done: false,
  };
  for (let i = start; i < text.length; i += 1) {
    state = advance(state, text[i]);
    if (state.done) return text.slice(start, i + 1);
  }
  return null;
}

function extractJsonBlock(text: string): string | null {
  return findFencedJson(text) ?? findBareJson(text);
}

interface ParsedResponse {
  reply: string;
  starter: NoteTypeStarterInput;
}

function isFieldList(value: unknown): value is AnkiNoteFieldInput[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (f) =>
      f &&
      typeof f === 'object' &&
      typeof (f as AnkiNoteFieldInput).name === 'string' &&
      typeof (f as AnkiNoteFieldInput).ord === 'number'
  );
}

function isTemplateList(value: unknown): value is AnkiCardTemplateInput[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (t) =>
      t &&
      typeof t === 'object' &&
      typeof (t as AnkiCardTemplateInput).name === 'string' &&
      typeof (t as AnkiCardTemplateInput).qfmt === 'string' &&
      typeof (t as AnkiCardTemplateInput).afmt === 'string' &&
      typeof (t as AnkiCardTemplateInput).ord === 'number'
  );
}

function validateStarter(value: unknown): NoteTypeStarterInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Claude did not return a starter object');
  }
  const candidate = value as Partial<NoteTypeStarterInput>;
  if (typeof candidate.name !== 'string') throw new Error('Missing name');
  if (typeof candidate.description !== 'string')
    throw new Error('Missing description');
  if (candidate.baseType !== 'basic' && candidate.baseType !== 'cloze') {
    throw new Error('baseType must be basic or cloze');
  }
  const noteType = candidate.noteType as Partial<AnkiNoteTypeInput> | undefined;
  if (!noteType || typeof noteType !== 'object') {
    throw new Error('Missing noteType');
  }
  if (noteType.type !== 0 && noteType.type !== 1) {
    throw new Error('noteType.type must be 0 or 1');
  }
  if (typeof noteType.css !== 'string') throw new Error('Missing noteType.css');
  if (!isTemplateList(noteType.tmpls)) {
    throw new Error('Invalid tmpls list');
  }
  if (!isFieldList(noteType.flds)) {
    throw new Error('Invalid flds list');
  }
  if (
    !candidate.previewData ||
    typeof candidate.previewData !== 'object' ||
    Array.isArray(candidate.previewData)
  ) {
    throw new Error('Missing previewData');
  }
  return {
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    baseType: candidate.baseType,
    noteType: {
      id: noteType.id,
      name: typeof noteType.name === 'string' ? noteType.name : candidate.name,
      type: noteType.type,
      tmpls: noteType.tmpls,
      flds: noteType.flds,
      css: noteType.css,
    },
    previewData: candidate.previewData,
    tags: Array.isArray(candidate.tags) ? candidate.tags : [],
  };
}

function parseResponse(text: string): ParsedResponse {
  const block = extractJsonBlock(text);
  if (!block) throw new Error('Claude did not return JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (error) {
    throw new Error(
      `Claude returned invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Claude response was not an object');
  }
  const payload = parsed as { reply?: unknown; starter?: unknown };
  const reply = typeof payload.reply === 'string' ? payload.reply : '';
  const starter = validateStarter(payload.starter);
  return { reply, starter };
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function askClaude(messages: ClaudeMessage[]): Promise<string> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  logClaudeUsage('AINoteTypeUseCase', response.usage);
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? b.text : ''))
    .join('');
}

export class AINoteTypeUseCase {
  async generate(prompt: string): Promise<AIGenerateResult> {
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('Prompt is required');
    }
    if (prompt.length > 2000) {
      throw new Error('Prompt is too long (max 2000 chars)');
    }
    const text = await askClaude([
      {
        role: 'user',
        content: `Design a new Anki note type for this request:\n\n${prompt}`,
      },
    ]);
    return parseResponse(text);
  }

  async modify(
    starter: NoteTypeStarterInput,
    instruction: string,
    history: ChatMessage[]
  ): Promise<AIGenerateResult> {
    if (typeof instruction !== 'string' || instruction.trim().length === 0) {
      throw new Error('Instruction is required');
    }
    if (instruction.length > 2000) {
      throw new Error('Instruction is too long (max 2000 chars)');
    }
    const sanitizedHistory = history
      .slice(-10)
      .filter(
        (m): m is ChatMessage =>
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string'
      );
    const messages: ClaudeMessage[] = [
      {
        role: 'user',
        content: `Here is the current note type:\n\n\`\`\`json\n${JSON.stringify(
          starter,
          null,
          2
        )}\n\`\`\`\n\nI'll ask you for changes; respond with the updated full starter object plus a reply summary.`,
      },
      {
        role: 'assistant',
        content: 'Got it. What would you like to change?',
      },
      ...sanitizedHistory,
      { role: 'user', content: instruction },
    ];

    const text = await askClaude(messages);
    const result = parseResponse(text);
    if (
      JSON.stringify(starter.noteType) ===
      JSON.stringify(result.starter.noteType)
    ) {
      console.warn('template_ai_modify.no_op', {
        instructionLength: instruction.length,
      });
    }
    return result;
  }
}

export const __test__ = {
  extractJsonBlock,
  parseResponse,
  validateStarter,
  SYSTEM_PROMPT,
};
