import { CardOptionDetail } from './CardOptionDetail';
import { CARD_OPTION_DEFAULTS } from '../../lib/parser/Settings/cardOptionDefaults';

const defaultFor = (key: string): boolean =>
  CARD_OPTION_DEFAULTS[key] === 'true';

const supportedOptions = (): CardOptionDetail[] => {
  const v = [
    new CardOptionDetail(
      'add-notion-link',
      'Add Notion link',
      'Add a link back to the Notion page on each card.',
      defaultFor('add-notion-link')
    ),
    new CardOptionDetail(
      'use-notion-id',
      'Use Notion ID',
      'Cards from Notion are identified by their block ID automatically. This setting only affects cards built from Notion database rows.',
      defaultFor('use-notion-id')
    ),
    new CardOptionDetail(
      'block-id-identity',
      'Block ID identity',
      "Identify new cards by their Notion block ID instead of their text. Cards you've already converted keep their remembered IDs either way.",
      defaultFor('block-id-identity')
    ),
    new CardOptionDetail(
      'all',
      'Use all toggle lists',
      'Pull toggles from anywhere on the page, including nested ones. Off, only top-level toggles become cards.',
      defaultFor('all')
    ),
    new CardOptionDetail(
      'paragraph',
      'Use plain text for back',
      'Strip formatting from the back of each card and keep only the text. Use this when colors and styles distract from review.',
      defaultFor('paragraph')
    ),
    new CardOptionDetail(
      'cherry',
      'Cherry-pick using 🍒 emoji',
      'Only build cards from toggles that contain 🍒 in the header or body. Use this to publish a few cards from a long page.',
      defaultFor('cherry')
    ),
    new CardOptionDetail(
      'avocado',
      'Skip toggles with the 🥑 emoji',
      'Ignore any toggle marked with 🥑. Use this to exclude drafts or notes without editing the page.',
      defaultFor('avocado')
    ),
    new CardOptionDetail(
      'tags',
      'Treat strikethrough as tags',
      'Turn strikethrough text into Anki tags. Strikethrough at the page level becomes a global tag; inside a toggle it tags only that card.',
      defaultFor('tags')
    ),
    new CardOptionDetail(
      'section-tags',
      'Tag a whole section',
      'Strike through a line under a parent toggle to tag every card nested beneath it — tag a whole section at once. Requires Cherry-pick mode.',
      defaultFor('section-tags')
    ),
    new CardOptionDetail(
      'cloze',
      'Cloze deletion',
      'Create cloze cards from inline code and {{c1::}} syntax in your toggles.',
      defaultFor('cloze')
    ),
    new CardOptionDetail(
      'cloze-from-toggle-content',
      'Inline code toggles become cloze',
      "When a toggle's contents contain inline code, hide the code as a cloze and use the toggle header as the hint. Works only when Cloze deletion is on.",
      defaultFor('cloze-from-toggle-content')
    ),
    new CardOptionDetail(
      'group-cloze-per-toggle',
      'Group cloze blanks per toggle',
      'When one Notion toggle holds several :: blanks, put them all on a single card and reveal them together. Off by default — each :: makes its own card.',
      defaultFor('group-cloze-per-toggle')
    ),
    new CardOptionDetail(
      'enable-input',
      'Treat bold text as input',
      'Hide bold words on the front of the card so you type them during review. Useful for vocabulary and exact-answer recall.',
      defaultFor('enable-input')
    ),
    new CardOptionDetail(
      'basic-reversed',
      'Basic and reversed',
      'Create two cards per toggle: question to answer, and answer to question.',
      defaultFor('basic-reversed')
    ),
    new CardOptionDetail(
      'reversed',
      'Reversed only',
      'Create only the reversed card, swapping front and back. Useful when the back is an image you want to see first.',
      defaultFor('reversed')
    ),
    new CardOptionDetail(
      'no-underline',
      'Remove underlines',
      'Strip underline formatting from card text. Turn this on if Notion underlines are showing up where you do not want them.',
      defaultFor('no-underline')
    ),
    new CardOptionDetail(
      'max-one-toggle-per-card',
      'Maximum one toggle per card',
      'Keep each card focused on a single toggle. Combine with Use all toggle lists to turn every nested toggle into its own card.',
      defaultFor('max-one-toggle-per-card')
    ),
    new CardOptionDetail(
      'remove-mp3-links',
      'Remove MP3 links from audio files',
      'Hide raw MP3 URLs on cards while keeping the audio playable.',
      defaultFor('remove-mp3-links')
    ),
    new CardOptionDetail(
      'perserve-newlines',
      'Preserve newlines in toggle header and body',
      'Keep line breaks made with Shift+Enter inside toggles. Applies to every card type.',
      defaultFor('perserve-newlines')
    ),
    new CardOptionDetail(
      'process-pdfs',
      'Process PDF files',
      'Convert PDFs found inside ZIP uploads into cards. Turn off to skip them and finish ZIP uploads faster.',
      defaultFor('process-pdfs')
    ),
    new CardOptionDetail(
      'pdf-extract-text',
      'Extract text from PDFs',
      'Turn the text inside a PDF into cards. Leave off to render each page as an image — page 1 on the front, page 2 on the back.',
      defaultFor('pdf-extract-text')
    ),
    new CardOptionDetail(
      'pdf-page-pairs',
      'Two pages make one card',
      'For PDFs laid out front then back — page 1 is the card front, page 2 its back. 2anki turns every 2 pages into one image card.',
      defaultFor('pdf-page-pairs')
    ),
    new CardOptionDetail(
      'download-pdfs',
      'Download PDFs as Anki media',
      'Off: PDFs appear as clickable links. On: PDFs are bundled into the .apkg, which makes the deck file much larger.',
      defaultFor('download-pdfs')
    ),
    new CardOptionDetail(
      'markdown-nested-bullet-points',
      'Markdown nested bullet points',
      'Turn bullets and their sub-bullets into front-and-back cards. Recommended for Obsidian exports.',
      defaultFor('markdown-nested-bullet-points')
    ),
    new CardOptionDetail(
      'split-sections-into-decks',
      'Split each section into its own deck',
      'When on, each heading, toggle, and list on the page becomes its own deck instead of all cards landing in one.',
      defaultFor('split-sections-into-decks')
    ),
    new CardOptionDetail(
      'vertex-ai-pdf-questions',
      'Generate questions from PDF uploads',
      'Drafts questions from your PDF using Claude (Anthropic). Your PDF content is sent to Anthropic for processing.',
      defaultFor('vertex-ai-pdf-questions')
    ),
    new CardOptionDetail(
      'disable-indented-bullets',
      'Disable indented bullets',
      'Keep indented bullets attached to their parent instead of becoming separate cards.',
      defaultFor('disable-indented-bullets')
    ),
    new CardOptionDetail(
      'image-quiz-html-to-anki',
      'Convert image quiz HTML to Anki cards',
      'Use OCR to pull images and answers out of HTML quizzes and turn them into cards.',
      defaultFor('image-quiz-html-to-anki')
    ),
    new CardOptionDetail(
      'embed-images',
      'Embed images in cards',
      'Pack image bytes into the deck so cards render offline. Turn off to ship a leaner deck when images are pushing the upload over the size cap.',
      defaultFor('embed-images')
    ),
    new CardOptionDetail(
      'claude-ai-flashcards',
      'Generate flashcards with Claude AI',
      'Use Claude AI to draft cards from your content. Produces stronger results on dense or unstructured documents.',
      defaultFor('claude-ai-flashcards')
    ),
    new CardOptionDetail(
      'ai-comprehensive',
      'Comprehensive AI mode',
      'Reads every section of long documents so nothing important gets skipped. Best for thorough study of dense material. Takes longer to make. Paid plans only.',
      defaultFor('ai-comprehensive')
    ),
    new CardOptionDetail(
      'share-files-for-debugging',
      'Share files for debugging when conversion fails',
      'On a failed conversion, send the uploaded files and error details to the 2anki team to investigate. Off by default to keep your notes private.',
      defaultFor('share-files-for-debugging')
    ),
  ];

  return v.filter(Boolean);
};

export default supportedOptions;
