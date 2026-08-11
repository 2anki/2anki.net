export type ChatCardTemplate = 'basic' | 'basic-and-reversed' | 'cloze' | 'mcq';

export const VALID_TEMPLATE_SLUGS: ReadonlySet<ChatCardTemplate> = new Set([
  'basic',
  'basic-and-reversed',
  'cloze',
  'mcq',
]);

export function isChatCardTemplate(value: unknown): value is ChatCardTemplate {
  return (
    typeof value === 'string' &&
    (VALID_TEMPLATE_SLUGS as Set<string>).has(value)
  );
}

const YIELD_TO_REQUEST = `Unless the user explicitly asks for a different card format in their latest message, follow this note type for every card. If they do ask for another format (in any language), honor their request using the card formats described earlier — and when you emit cloze cards this way, write \`Format: cloze\` on its own line immediately before the JSON block.`;

const TEMPLATE_PROMPT_SUFFIX: Record<ChatCardTemplate, string> = {
  basic: `
DEFAULT NOTE TYPE — basic front/back. ${YIELD_TO_REQUEST}

By default every card is a plain front/back pair:
- "front" holds the question or prompt
- "back" holds the answer and must be non-empty
- No {{cN::...}} cloze syntax, no answer-option lists`,
  'basic-and-reversed': `
DEFAULT NOTE TYPE — basic + reverse. ${YIELD_TO_REQUEST}

Each card will appear in Anki as BOTH a question→answer AND answer→question pair. Make sure every card makes sense in both directions (e.g. terms and definitions, language pairs).`,
  cloze: `
DEFAULT NOTE TYPE — cloze deletion. ${YIELD_TO_REQUEST}

By default every card is a cloze deletion. For each card:
- "front" contains the full sentence with the answer wrapped as {{c1::answer}}
- "back" is the empty string ""
- Use {{c1::...}}, {{c2::...}} for multiple blanks in the same sentence
- Do NOT use bare ___ placeholders

Example output for the topic "capitals":

\`\`\`json
[
  {"front": "The capital of Norway is {{c1::Oslo}}.", "back": ""},
  {"front": "The capital of {{c1::France}} is Paris.", "back": ""}
]
\`\`\``,
  mcq: `
TEMPLATE OVERRIDE — multiple choice (this overrides any earlier instruction about front/back cards):

EVERY card you emit must be a multiple-choice question with exactly four options. Wrap them in a JSON code block using EXACTLY this format:

\`\`\`json
[
  {"front": "What is the capital of Norway?", "options": ["Bergen", "Oslo", "Trondheim", "Stavanger"], "correct_index": 1, "rationale": "Oslo has been Norway's capital since 1814."}
]
\`\`\`

Rules:
- Use exactly four options
- correct_index is the 0-based position of the right option (0, 1, 2, or 3)
- rationale is a brief explanation of why the correct option is right
- Do NOT include a "back" field
- The "front" stem must NOT contain cloze deletion syntax like {{c1::...}}; if basing a question on a cloze sentence, replace the deleted span with a blank (_____)
- Do NOT emit any front/back Q&A pairs or cloze cards — only MCQ cards are valid in this conversation`,
};

export function templatePromptSuffix(slug: ChatCardTemplate): string {
  return TEMPLATE_PROMPT_SUFFIX[slug];
}

const CLOZE_FORBIDDING_TEMPLATES: ReadonlySet<ChatCardTemplate> = new Set([
  'basic',
  'basic-and-reversed',
]);

export function templateForbidsCloze(slug: string | null | undefined): boolean {
  return isChatCardTemplate(slug) && CLOZE_FORBIDDING_TEMPLATES.has(slug);
}
