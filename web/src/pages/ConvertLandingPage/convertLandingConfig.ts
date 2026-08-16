import type { LandingCopy } from '../LandingPage/types';
import { ankiFidelityProof } from '../LandingPage/copy/ankiFidelityProof';

const notionToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Convert Notion tables to Anki',
      href: '/convert/notion-tables-to-anki',
    },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/notion-to-anki',
  canonicalPathname: '/notion-to-anki',
  title: 'Notion to Anki — decks that open clean in Anki | 2anki',
  description:
    'Convert any Notion page to an Anki deck that opens clean — cloze stays clickable, images render, toggles become cards. Paste a link, get a .apkg.',
  h1: 'Notion to Anki — turn your notes into flashcards',
  subhead:
    'Connect Notion once, paste any page link, get a .apkg deck. Toggles become cards. No add-on, no copy-pasting.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How do I connect my Notion workspace?',
      a: 'Sign in to 2anki, go to the upload page, and click "Connect Notion". You authorise read access once — we use it only to read pages you select.',
    },
    {
      q: 'Which Notion block types become cards?',
      a: 'Toggle blocks are the primary card source: the toggle heading becomes the front, the body becomes the back. Strikethrough text in the page body is turned into a tag on every card in that deck.',
    },
    {
      q: 'Do images and code blocks survive the conversion?',
      a: "Both come across. Images embed in the card, code blocks keep their formatting. Anything we can't fetch is replaced with a short note so the card still works.",
    },
    {
      q: 'Can I re-convert a page after editing it in Notion?',
      a: 'Yes — paste the same link again to get a fresh deck. If you want edits to sync automatically every few minutes, see Auto Sync on the pricing page.',
    },
  ],
};

const pdfToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'AI flashcard generator', href: '/ai-flashcard-generator' },
    { label: 'Convert PowerPoint slides to Anki', href: '/powerpoint-to-anki' },
    { label: 'Convert an HTML file to Anki', href: '/convert/html-to-anki' },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/pdf-to-anki',
  canonicalPathname: '/pdf-to-anki',
  title: 'Convert PDF to Anki — flashcards that work in Anki | 2anki',
  description:
    'Convert a lecture PDF, slide export, or textbook chapter into a .apkg deck. Text becomes question-and-answer cards, scanned pages become image cards, and AI mode handles dense chapters.',
  h1: 'Convert PDF to Anki — flashcards from lecture slides and textbook chapters',
  subhead:
    'Drop a lecture PDF, slide export, or textbook chapter and download a .apkg deck. 2anki reads the text into question-and-answer cards, falls back to image cards when a page has no text, and can write cards with AI when the PDF is dense.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How do text PDFs become cards?',
      a: 'When a PDF carries a text layer, 2anki reads it and pairs the pages into cards — the text on one page becomes the front, the next page becomes the back. You get editable text cards you can fix in Anki in seconds, not flattened images.',
    },
    {
      q: 'What about scanned PDFs and slide decks?',
      a: "A photo scan with no text layer can't be read as text. When there's no usable text, 2anki falls back to image cards: each page is paired with the next as a front-and-back image, so you still get a reviewable deck. For a true photo scan, add a text layer with OCR in macOS Preview or Adobe Acrobat first, then upload for text cards.",
    },
    {
      q: 'Is there an AI mode for dense chapters?',
      a: 'Yes. When a chapter is wall-to-wall prose with no clean front/back split, the AI flashcard mode reads the content and writes question-and-answer cards for you. They land as basic notes you can edit, tag, and move into a subdeck.',
    },
    {
      q: 'Can I upload a whole textbook?',
      a: 'Yes. Large PDFs work, though big files take longer and create large decks. Free accounts handle everyday lecture and chapter PDFs; paid plans lift the size limit. Uploading one chapter at a time keeps decks easier to review.',
    },
    {
      q: 'What happens to equations and diagrams?',
      a: 'Equations stored as images stay as images. Equations stored as text need MathJax enabled in your Anki card template to render. In image mode, the full page comes across as an image so diagrams stay intact.',
    },
  ],
};

const markdownToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    { label: 'Convert an HTML file to Anki', href: '/convert/html-to-anki' },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/markdown-to-anki',
  canonicalPathname: '/markdown-to-anki',
  title: 'Markdown to Anki — decks that open clean in Anki | 2anki',
  description:
    'Convert Markdown or Obsidian notes to an Anki deck that opens clean — code blocks intact, cloze clickable, bullets become cards.',
  h1: 'Markdown to Anki — convert .md files and Obsidian notes',
  subhead:
    'Drop a .md file and download a deck — bullets, Q/A pairs, and code blocks all come across.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How does it turn Markdown into cards?',
      a: 'Top-level bullets become card fronts; a nested bullet underneath becomes the answer. The first heading names the deck. A full guide is in the docs.',
    },
    {
      q: 'Can I write Q/A pairs instead of using bullet nesting?',
      a: "Yes — write 'Q: question' followed by 'A: answer' on the next line and we detect the pattern automatically. Mix Q/A and bullet-style cards in the same file.",
    },
    {
      q: 'Does Obsidian-flavoured Markdown work?',
      a: 'Standard Obsidian formatting — bullets, headings, bold, italic, code blocks — converts cleanly. Obsidian-specific syntax like block embeds and graph links is ignored rather than erroring.',
    },
    {
      q: 'What about LaTeX and code blocks?',
      a: 'Triple-backtick code blocks come across as text inside the card. LaTeX inside $...$ and $$...$$ renders if MathJax is enabled in your Anki card template settings.',
    },
  ],
};

const csvToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'Export an Anki deck to CSV', href: '/convert/apkg-to-csv' },
    { label: 'Convert an HTML file to Anki', href: '/convert/html-to-anki' },
    {
      label: 'Move Brainscape flashcards to Anki',
      href: '/convert/brainscape-to-anki',
    },
    { label: 'Convert Quizlet sets to Anki', href: '/quizlet-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/csv-to-anki',
  title: 'CSV to Anki — spreadsheets to clean Anki decks | 2anki',
  description:
    'Import a CSV or Excel sheet as an Anki deck that opens clean — correct fields, one row per card.',
  h1: 'CSV to Anki — import spreadsheets as flashcard decks',
  subhead:
    'Drop a .csv file and get a .apkg deck. Column A becomes the front, everything after A joins into the back. Works with Excel exports too.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'What format does the CSV need to be in?',
      a: 'Column A is the front. Everything after A is joined into the back with spaces. Use a 2-column file for the cleanest result. A header row is detected and skipped automatically. UTF-8 encoding works best for accented characters and CJK text.',
    },
    {
      q: 'Can I import an Excel .xlsx file directly?',
      a: 'Yes — upload the .xlsx file and we convert it. If the spreadsheet has multiple sheets, the first sheet is used. A header row that looks like labels (short non-numeric text in every column) is detected and skipped.',
    },
    {
      q: 'How do I name the deck?',
      a: 'The deck name comes from the filename — rename the file before uploading and the deck will match. You can also rename the deck inside Anki after importing.',
    },
    {
      q: 'Where do tags come from?',
      a: "v1 doesn't add tags from CSV columns. To tag cards, edit them in Anki after import, or paste the deck through Notion where strikethrough text becomes a tag on every card.",
    },
  ],
};

const htmlToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/html-to-anki',
  title: 'HTML to Anki — web pages to clean Anki decks | 2anki',
  description:
    'Convert an HTML file to an Anki deck that opens clean — images embedded, tables row by row, headings as decks.',
  h1: 'HTML to Anki — turn web pages into flashcard decks',
  subhead:
    'Drop an .html file and download a .apkg deck. Headings, bullets, and tables all come across.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Where does the HTML come from?',
      a: 'Save a web page from your browser (File → Save As → Webpage, Complete or HTML Only), or export notes from an app that exports HTML. Drop the file here and we convert it.',
    },
    {
      q: 'Which HTML elements become cards?',
      a: 'H1 and H2 headings name decks and subdecks. List items and short paragraphs become card fronts; the next sibling block becomes the back. Tables are converted row by row.',
    },
    {
      q: 'Do inline styles and images survive?',
      a: "Images embedded in the page come across. Most inline styles are stripped — the cards use Anki's own card template styling instead.",
    },
    {
      q: 'Can I use a Notion HTML export?',
      a: 'Yes. If you export a Notion page as HTML (from the Notion desktop app), upload the zip file here and we process the full export including images.',
    },
  ],
};

const apkgToCsv: LandingCopy = {
  relatedLinks: [
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    { label: 'Convert Anki notes to Notion', href: '/anki-to-notion' },
    { label: 'Convert an HTML file to Anki', href: '/convert/html-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/apkg-to-csv',
  title: 'Anki deck to CSV — export cards to a spreadsheet | 2anki',
  description:
    'Upload an .apkg file and download a CSV with every card. Edit in Excel or Google Sheets, then import back into Anki.',
  h1: 'Anki deck to CSV — export cards to a spreadsheet',
  subhead:
    'Drop an .apkg file and download a CSV. Every card front, back, and tag in one spreadsheet you can edit.',
  // This page runs the opposite direction to the rest of the site: a deck goes
  // in and a spreadsheet comes out. The shared steps and format list describe
  // building a deck, so without these overrides the page tells visitors to drop
  // a Notion export and open an .apkg it never makes.
  steps: [
    {
      title: 'Choose your .apkg',
      body: 'Any Anki deck file — your own, or one you downloaded.',
    },
    {
      title: '2anki reads every card',
      body: 'Fronts, backs, and tags, including cloze markup.',
    },
    {
      title: 'Open the CSV',
      body: 'Excel, Google Sheets, or any spreadsheet app.',
    },
  ],
  formats: ['.apkg in', 'CSV out'],
  faqs: [
    {
      q: 'Why would I export to CSV?',
      a: "To bulk-edit cards in a spreadsheet, share the deck content with someone who doesn't use Anki, or migrate cards to another tool. The CSV is plain text — any spreadsheet app opens it.",
    },
    {
      q: 'What columns does the CSV have?',
      a: 'Front, Back, and Tags at minimum. Cloze deletion cards export with the full cloze markup intact so you can re-import them later.',
    },
    {
      q: 'Can I edit the CSV and import it back into Anki?',
      a: "Yes. Edit in Excel or Google Sheets, save as CSV, and import using Anki's built-in File → Import. Match the note type and field order when importing.",
    },
    {
      q: 'Does it work with shared and downloaded decks?',
      a: 'Any .apkg file works — decks you made yourself, decks from AnkiWeb, or decks shared by others. We read the file; there is no connection to AnkiWeb.',
    },
  ],
};

const notionTablesToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/notion-tables-to-anki',
  title: 'Notion tables to Anki — one row, one card | 2anki',
  description:
    'Convert a Notion table into Anki flashcards. Column 1 becomes the front, column 2 becomes the back. Download a .apkg deck.',
  h1: 'Notion tables to Anki — one row, one card',
  subhead:
    'Paste a Notion page with a table. Column 1 becomes the front, column 2 becomes the back.',
  faqs: [
    {
      q: 'What if my table has more than two columns?',
      a: 'Columns 3 and beyond show up on the back of the card as a small inline table, below the main answer. Use it for example sentences, mnemonics, or notes.',
    },
    {
      q: 'Does the header row become a card?',
      a: 'If Notion\'s "header row" toggle is on for that table, we skip it. Otherwise the first row becomes a card like the rest — you can delete it in Anki.',
    },
    {
      q: 'Can I keep using toggles too?',
      a: 'Yes. Tables, toggles, and headings can all source cards from the same page. The Rules page lets you turn each one on or off.',
    },
    {
      q: 'Will images inside cells convert?',
      a: 'Not yet — image-in-cell support is on the roadmap. For now, cells with only an image render as empty; cells with text + image keep the text.',
    },
  ],
};

const brainscapeToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Move StudyStack flashcards to Anki',
      href: '/convert/studystack-to-anki',
    },
    { label: 'Move Zorbi flashcards to Anki', href: '/convert/zorbi-to-anki' },
    { label: 'Convert Quizlet sets to Anki', href: '/quizlet-to-anki' },
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/brainscape-to-anki',
  title: 'Brainscape to Anki — move your flashcards to Anki | 2anki',
  description:
    'Move your Brainscape flashcards to Anki. Export your deck as a CSV, upload it here, and download a .apkg deck that opens clean.',
  h1: 'Move your Brainscape flashcards to Anki',
  subhead:
    'Export your Brainscape deck as CSV, drop it here, get a .apkg deck that opens clean in Anki.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How do I get a CSV out of Brainscape?',
      a: 'Open the deck you own, click the deck options menu, and pick Export. Brainscape has historically gated export behind a Pro plan — confirm in your account before you rely on it.',
    },
    {
      q: 'Does this work for decks I did not make?',
      a: 'No. Brainscape only lets you export decks you own. Copy the cards into a deck on your own account first, then export that one.',
    },
    {
      q: 'What gets carried across?',
      a: 'Whatever sits in the CSV columns. Brainscape exports the question and answer text by default — those become the card front and back. Extra columns map to extra fields if your CSV has them.',
    },
    {
      q: 'Do images come across?',
      a: "No. Brainscape's CSV export is text-only — images and audio stay in Brainscape. Re-add any visuals in Anki after import, or paste the image link if the CSV captured one.",
    },
  ],
};

const lingvistToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'Move Pleco flashcards to Anki', href: '/convert/pleco-to-anki' },
    {
      label: 'Move Language Reactor saves to Anki',
      href: '/convert/language-reactor-to-anki',
    },
    { label: 'Move Zorbi flashcards to Anki', href: '/convert/zorbi-to-anki' },
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/lingvist-to-anki',
  title: 'Lingvist to Anki — move your flashcards to Anki | 2anki',
  description:
    'Move your Lingvist flashcards to Anki. Export your vocabulary as a CSV, upload it here, and download a .apkg deck that opens clean.',
  h1: 'Move your Lingvist flashcards to Anki',
  subhead:
    'Export your Lingvist vocabulary as a CSV, drop it here, and get a .apkg deck. Your words and translations come across as basic cards.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How do I export from Lingvist?',
      a: 'Lingvist offers an account-data download — search Lingvist\'s help center at help.lingvist.com for "data export" to find the current path. The download includes a CSV of your vocabulary that you can upload here.',
    },
    {
      q: 'Which columns does Lingvist export?',
      a: 'The CSV typically has the target word in one column and the translation in another. Column A becomes the card front, column B becomes the back.',
    },
    {
      q: 'Will my progress and statistics transfer?',
      a: 'Card content transfers — the word and translation. Lingvist progress data stays in Lingvist. Anki will schedule the imported cards from scratch using its own spaced repetition algorithm.',
    },
    {
      q: 'Can I keep using Lingvist and Anki together?',
      a: 'Yes. Export again any time to get an updated deck with your newest vocabulary. Re-import into Anki to add the new cards.',
    },
  ],
};

const studystackToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Move Brainscape flashcards to Anki',
      href: '/convert/brainscape-to-anki',
    },
    { label: 'Move Zorbi flashcards to Anki', href: '/convert/zorbi-to-anki' },
    { label: 'Convert Quizlet sets to Anki', href: '/quizlet-to-anki' },
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/studystack-to-anki',
  title: 'StudyStack to Anki — move your flashcards to Anki | 2anki',
  description:
    'Move your StudyStack flashcards to Anki. Export your stack as a CSV or text file, upload it here, and download a .apkg deck.',
  h1: 'Move your StudyStack flashcards to Anki',
  subhead:
    'Export your StudyStack as a CSV, drop it here, and get a .apkg deck. Terms and definitions become basic cards ready to review in Anki.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How do I export from StudyStack?',
      a: "Open your stack on studystack.com and look for the export or download option in the stack's menu. The exported file should contain your terms and definitions, ready to upload here.",
    },
    {
      q: 'What format does the exported file use?',
      a: 'StudyStack exports a two-column file — term in the first column, definition in the second. That maps directly to card front and back.',
    },
    {
      q: 'Do images and audio come across?',
      a: 'Plain text and simple HTML in your cards transfers. Images attached inside StudyStack cards are not included in the CSV export.',
    },
    {
      q: 'How many cards can I import?',
      a: 'Free 2anki accounts convert up to 100 cards per month — this is the 2anki limit, not a StudyStack restriction. Unlimited and Auto Sync plans remove the cap — see the pricing page.',
    },
  ],
};

const plecoToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Move Lingvist flashcards to Anki',
      href: '/convert/lingvist-to-anki',
    },
    {
      label: 'Move Language Reactor saves to Anki',
      href: '/convert/language-reactor-to-anki',
    },
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    {
      label: 'Build Japanese Anki cards from Notion',
      href: '/anki-for-japanese',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/pleco-to-anki',
  title: 'Pleco to Anki — move your flashcards to Anki | 2anki',
  description:
    'Move your Pleco flashcards to Anki. Export your userdict as a .txt file, upload it here, and download a .apkg deck with your Chinese vocabulary.',
  h1: 'Move your Pleco flashcards to Anki',
  subhead:
    'Export your Pleco userdict as a .txt file, drop it here, and get a .apkg deck. Hanzi, pinyin, and definitions come across as basic cards.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Which Pleco export format works?',
      a: 'The tab-separated .txt userdict export works through our CSV pipeline. The XML userdict export does not — it carries Pleco-specific scheduling and category metadata we do not parse. Export as .txt and you are set.',
    },
    {
      q: 'How do I export the .txt file from Pleco?',
      a: 'In the Pleco app, open the flashcards module, go to Import/Export, choose Export Cards, and select the text file format. Save the file to your device, then upload it here.',
    },
    {
      q: 'Will hanzi, pinyin, and definitions all come across?',
      a: 'Yes. Each row in the .txt export becomes one card: hanzi on the front, pinyin and the English definition on the back. Tone marks and traditional or simplified characters are preserved.',
    },
    {
      q: 'Will my SRS progress and custom categories transfer?',
      a: 'Card content transfers — the words and definitions. Pleco review history, scheduling, and custom categories stay in Pleco; Anki schedules the imported cards from scratch with its own algorithm.',
    },
  ],
};

const zorbiToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Move Brainscape flashcards to Anki',
      href: '/convert/brainscape-to-anki',
    },
    {
      label: 'Move StudyStack flashcards to Anki',
      href: '/convert/studystack-to-anki',
    },
    { label: 'Convert Quizlet sets to Anki', href: '/quizlet-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/zorbi-to-anki',
  title: 'Zorbi to Anki — move your flashcards to Anki | 2anki',
  description:
    'Move your Zorbi flashcards to Anki. Export your deck as a CSV, upload it here, and download a .apkg deck that opens clean.',
  h1: 'Move your Zorbi flashcards to Anki',
  subhead:
    'Export your Zorbi deck as a CSV, drop it here, and get a .apkg deck. Questions and answers become basic Anki cards.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How do I export from Zorbi?',
      a: "Open your deck on zorbi.com and look for the export option in the deck menu. Download the CSV and upload it here. If you can't find the export option, check Zorbi's help docs for the current path.",
    },
    {
      q: 'Do cloze deletions transfer?',
      a: 'If your Zorbi cards use cloze-style blanks and the export includes the full text with markup, those cards will convert as cloze notes in Anki. Plain Q/A cards convert as basic notes.',
    },
    {
      q: 'Will my review history carry over?',
      a: 'Card content transfers — the question and answer. Review history and scheduling data stays in Zorbi. Anki reschedules imported cards from the beginning.',
    },
    {
      q: 'Can I import a Zorbi deck shared by someone else?',
      a: "Yes, if you have access to export the shared deck. Download the CSV from Zorbi, then upload it here. The deck name comes from the filename — rename it before uploading if you'd like a different name.",
    },
  ],
};

const languageReactorToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Move Lingvist flashcards to Anki',
      href: '/convert/lingvist-to-anki',
    },
    { label: 'Move Pleco flashcards to Anki', href: '/convert/pleco-to-anki' },
    { label: 'Convert EPUB highlights to Anki', href: '/convert/epub-to-anki' },
    {
      label: 'Anki for Japanese — JLPT, kanji, vocab',
      href: '/anki-for-japanese',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/language-reactor-to-anki',
  title: 'Language Reactor to Anki — move your saved phrases to Anki | 2anki',
  description:
    'Move your Language Reactor saves to Anki. Export the zip from Language Reactor, upload it here, and download a .apkg deck with your phrases, images, and audio.',
  h1: 'Move your Language Reactor saves to Anki',
  subhead:
    'Drop the export zip from Language Reactor — your saved phrases, images, and audio come across as a clean .apkg you can study on any device.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How do I export from Language Reactor?',
      a: 'Open the Language Reactor extension, go to your saved phrases, and use the Export option to download a ZIP. The ZIP contains a CSV of your phrases together with the images and audio captured from the source video and subtitles.',
    },
    {
      q: "What's in the export?",
      a: 'Your saved phrases become cards — the phrase on the front, the translation and context on the back. Images and audio captured from the source video come across embedded so each card keeps its sentence audio and screenshot.',
    },
    {
      q: 'Why do the thumbnails look blank in Anki on my phone?',
      a: 'Language Reactor stores card thumbnails using CSS background-image URLs. Anki desktop renders these; Anki mobile on iOS and Android does not. The phrase, translation, and audio still work — only the thumbnail image is missing on mobile. Workaround: study these cards on desktop, or wait for the automatic rewrite that turns background-image into a regular img tag (planned).',
    },
    {
      q: 'Does the sentence audio stay paired with the right card?',
      a: 'Yes. Each audio clip is named in the export so it stays attached to the phrase it came from. After import, tapping the play button on a card plays the original line from the source video.',
    },
  ],
};

const epubToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Convert Kindle highlights to Anki',
      href: '/convert/kindle-to-anki',
    },
    {
      label: 'Move Language Reactor saves to Anki',
      href: '/convert/language-reactor-to-anki',
    },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/epub-to-anki',
  title: 'EPUB highlights to Anki — turn ebook highlights into cards | 2anki',
  description:
    'Turn the passages you highlighted in a DRM-free EPUB into an Anki deck. Upload the file and get a .apkg — each highlight on a card, with the book and author on the back.',
  h1: 'EPUB highlights to Anki — from ebook highlights to cards',
  subhead:
    'Drop a DRM-free .epub and download a .apkg. Each passage you highlighted becomes a card, with the book title and author on the back.',
  faqs: [
    {
      q: 'Which EPUB files work?',
      a: 'DRM-free EPUBs — the kind from Project Gutenberg, Standard Ebooks, or a publisher who sells unlocked files. DRM-locked files can’t be opened; use a DRM-free copy instead.',
    },
    {
      q: 'How does an ebook become flashcards?',
      a: 'Each passage you highlighted in the ebook becomes one card — the highlight on the front, the book title and author on the back so you remember where it came from.',
    },
    {
      q: 'Where does the deck name come from?',
      a: 'From the book’s title if the EPUB carries one, otherwise the filename. Rename the file before uploading if you want a cleaner fallback name in Anki.',
    },
    {
      q: 'Can I keep using EPUB and Kindle highlights together?',
      a: 'Yes. Convert an EPUB for the passages you highlighted in a DRM-free book, and upload a Kindle My Clippings.txt for the highlights you marked on a Kindle. Both produce a deck you study in Anki.',
    },
  ],
};

const kindleToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'Convert EPUB highlights to Anki', href: '/convert/epub-to-anki' },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/kindle-to-anki',
  title: 'Kindle highlights to Anki — My Clippings.txt to a deck | 2anki',
  description:
    'Turn your Kindle My Clippings.txt into an Anki deck. Copy the file off your Kindle, upload it, and get a .apkg — each highlight and note on a card, with the book and author on the back.',
  h1: 'Kindle highlights to Anki — from My Clippings.txt to a deck',
  subhead:
    'Copy My Clippings.txt off your Kindle, drop it here, and download a .apkg. Each passage you highlighted — and any note you typed — becomes a card.',
  faqs: [
    {
      q: 'Where do I find My Clippings.txt?',
      a: 'Connect your Kindle to your computer by USB. Open the device in your file browser, go to the documents folder, and copy My Clippings.txt. That single file holds every highlight, note, and bookmark across all your books.',
    },
    {
      q: 'What becomes a card?',
      a: 'Every highlight and note becomes one card — the passage on the front, the book title and author on the back. Bookmarks are skipped. You review exactly what you marked while reading.',
    },
    {
      q: 'Which Kindle languages are recognized?',
      a: 'Kindles set to English, German, Spanish, or French. 2anki reads the highlight and note markers in those four languages; a Kindle set to another language may not be picked up.',
    },
    {
      q: 'Can I upload highlights from several books at once?',
      a: 'Yes. My Clippings.txt spans every book on the device, so one upload turns all your recent highlights into a single deck. Split it into subdecks inside Anki after import if you want one deck per book.',
    },
  ],
};

const excelToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    {
      label: 'Convert Notion tables to Anki',
      href: '/convert/notion-tables-to-anki',
    },
    {
      label: 'Word to Anki — a step-by-step guide',
      href: '/answers/word-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/excel-to-anki',
  title: 'Excel to Anki — turn a spreadsheet into cards | 2anki',
  description:
    'Upload an .xlsx spreadsheet and download an Anki deck. Each row becomes a card — one column front, one column back. No add-on, no copy-paste.',
  h1: 'Excel to Anki — turn a spreadsheet into flashcards',
  subhead:
    'Drop an .xlsx file and download a .apkg deck. Each row becomes a card — first column front, second column back.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How do I turn an Excel spreadsheet into Anki cards?',
      a: 'Save your sheet as an .xlsx file with one column for the front of the card and one for the back, upload it here, and download the .apkg deck. Open the deck in Anki to review. No add-on or copy-paste needed.',
    },
    {
      q: 'Which column becomes the front of the card?',
      a: "The first column is the front, the second column is the back. A header row is read as column names and isn't turned into a card, so you can label the columns whatever you like.",
    },
    {
      q: 'Do images or cell formatting carry over from Excel?',
      a: 'No. Text converts cleanly, including line breaks inside a cell, but embedded images, charts, colors, fonts, and formulas are dropped — a formula cell exports as its text result. For cards with images, use the HTML or Notion upload path.',
    },
    {
      q: 'My workbook has several tabs — will all of them convert?',
      a: 'The first sheet is the one converted. If you have multiple tabs, split each into its own .xlsx file and upload them separately.',
    },
    {
      q: 'What if my file is a .csv instead of an .xlsx?',
      a: 'Use the CSV to Anki path — it follows the same two-column layout, first column front and second column back. Both .csv and .xlsx are supported upload formats.',
    },
  ],
};

const wordToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Word to Anki — a step-by-step guide',
      href: '/answers/word-to-anki',
    },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/word-to-anki',
  title: 'Word to Anki — convert a .docx to flashcards | 2anki',
  description:
    'Upload a Word .docx and download an Anki deck. Headings and bold text become card fronts, the body becomes the back. No add-on required.',
  h1: 'Word to Anki — convert a Word document into flashcards',
  subhead:
    'Upload a .docx and download a .apkg deck. Headings become card fronts, the text beneath becomes the back. No add-on.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Do I need an Anki add-on to convert a Word document?',
      a: 'No. The conversion runs in your browser on 2anki — you upload the .docx and download a .apkg file. Import that into Anki the normal way. Nothing to install in Anki itself.',
    },
    {
      q: 'What in my document becomes the front of the card?',
      a: "Headings. Each heading (H1 through H6) starts a new card and becomes its front; the paragraphs, lists, and images beneath it — up to the next heading — become the back. If your notes have no headings, add them where each card should begin, or you'll get one large card instead of many.",
    },
    {
      q: 'Can I convert a Google Doc to Anki this way?',
      a: 'Yes. In Google Docs choose File → Download → Microsoft Word (.docx), then upload that file. Docs export cleanly to .docx, so the same heading-to-card behaviour applies.',
    },
    {
      q: "Why won't my .docx upload?",
      a: 'The most common cause is a file renamed from another format rather than exported as a real .docx — for example a .pages or old .doc file given a .docx extension. Open it in Word or Google Docs and re-save or re-download as .docx, then upload again.',
    },
    {
      q: 'Do images and formatting survive the conversion?',
      a: 'Bold, italic, bullet and numbered lists, and embedded images all come across. Images are bundled into the deck so they render on the card rather than linking out. Equations stored as text need MathJax enabled in your Anki template to display.',
    },
  ],
};

const obsidianToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Obsidian to Anki — a step-by-step guide',
      href: '/answers/obsidian-to-anki',
    },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/obsidian-to-anki',
  title: 'Obsidian to Anki — export notes to a deck | 2anki',
  description:
    'Convert Obsidian Markdown notes into an Anki .apkg deck without a plugin. Upload a note or a vault export and download cards that open clean.',
  h1: 'Obsidian to Anki — turn your vault notes into flashcards',
  subhead:
    'Upload a Markdown note or a zipped vault folder and download a .apkg deck. No plugin, no code pasted into your notes.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Can I convert Obsidian notes to Anki without a plugin?',
      a: 'Yes. Obsidian notes are plain Markdown, so you upload the .md file or a zipped folder to 2anki and download a .apkg deck. Nothing is installed in Obsidian and no code is pasted into your notes.',
    },
    {
      q: 'How does 2anki decide what becomes a card?',
      a: "Two patterns. A top-level bullet becomes the front and a nested bullet underneath becomes the back. Or write 'Q: question' followed by 'A: answer' on the next line. You can mix both in the same note.",
    },
    {
      q: 'Can I convert my whole vault at once?',
      a: 'Zip a folder from your vault and upload the .zip. Each note keeps its own deck name from its first heading. Uploading a folder at a time keeps the resulting decks easier to review than one giant export.',
    },
    {
      q: 'What happens to wikilinks and block embeds?',
      a: "Obsidian-specific syntax like [[wikilinks]] and ![[block embeds]] doesn't map to a card field, so it's skipped rather than turned into a broken card. Bullets, headings, bold, italic, and code blocks convert normally.",
    },
    {
      q: 'Does LaTeX from my notes render in Anki?',
      a: 'The math text always comes across. It renders as an equation only if MathJax is enabled in your Anki card template, using $…$ for inline and $$…$$ for block math.',
    },
  ],
};

const photoToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Handwritten notes to Anki — a guide',
      href: '/answers/handwritten-notes-to-anki',
    },
    {
      label: 'Image occlusion in Anki — a guide',
      href: '/answers/image-occlusion-anki',
    },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    { label: 'AI flashcard generator', href: '/ai-flashcard-generator' },
  ],
  pathname: '/convert/photo-to-anki',
  title: 'Photo to Anki — snap notes into flashcards | 2anki',
  description:
    'Upload a photo of your notes or a textbook page and get an Anki deck. AI reads the image and writes question-and-answer cards you can edit.',
  h1: 'Photo to Anki — turn a picture of your notes into flashcards',
  subhead:
    'Upload a photo of your notes or a textbook page. AI reads the image and drafts question-and-answer cards you review before download.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Can it read my handwriting?',
      a: 'Legible handwriting reads well. The clearer the writing and the better the lighting, the fewer corrections you make at the review step. Every card is shown before download, so you catch any misread word before it lands in your deck.',
    },
    {
      q: 'What photo formats can I upload?',
      a: 'JPEG, PNG, WebP, GIF, and HEIC/HEIF — the format an iPhone shoots by default — up to 10 MB per photo. You can take the photo with your camera or pick one from your library.',
    },
    {
      q: 'Do I get to check the cards before they go into Anki?',
      a: "Yes. AI reads the photo and drafts the cards, then shows every card for review. Fix a misread word, cut a card you don't want, and keep the rest before you download the APKG file.",
    },
    {
      q: 'How many photos can I turn into cards?',
      a: 'Add several photos at once — one per page, or a few pages of the same topic in one go. The free plan covers 5 photos per month; paid plans lift the limit.',
    },
    {
      q: 'I have the notes as a PDF, not a photo. What then?',
      a: 'Use PDF to Anki instead — it reads a whole chapter in one upload, which is faster than photographing each page. Photo to Anki is for pictures: handwritten notes, a single textbook page, or a lecture slide you snapped.',
    },
  ],
};

const googleSlidesToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'Convert PowerPoint slides to Anki', href: '/powerpoint-to-anki' },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    {
      label: 'Anki from medical lecture slides',
      href: '/anki-from-medical-lecture-slides',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/google-slides-to-anki',
  title: 'Google Slides to Anki — slides into cards | 2anki',
  description:
    'Export Google Slides to PDF, upload it, and download an Anki deck. Each slide becomes a card front, speaker notes or the next slide the back.',
  h1: 'Google Slides to Anki — turn a lecture deck into flashcards',
  subhead:
    'Export your Slides deck to PDF, upload it, and download a .apkg. Each slide becomes a card you can edit before download.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Can I convert Google Slides to Anki directly, without exporting?',
      a: 'Not directly — export the deck to PDF first (File, Download, PDF Document). 2anki reads the PDF and turns each slide into a card. The export takes a few seconds and keeps images and diagrams intact.',
    },
    {
      q: 'How does 2anki decide the front and back of each card?',
      a: 'By default the slide is the front and the following slide is the back, so a question-then-answer sequence lines up for review. If your deck has speaker notes, those can go on the back instead. You can change the front and back before downloading.',
    },
    {
      q: 'Will images and diagrams from my slides come through?',
      a: 'Yes. Anything visible on the slide when you export to PDF — charts, diagrams, images — comes through on the card. Staged animations flatten to their final state in the export.',
    },
    {
      q: 'What file do I get back, and how do I open it?',
      a: 'You download an Anki .apkg file. Double-click it to import into Anki desktop, or import it through AnkiWeb. The whole lecture lands as a deck of cards.',
    },
    {
      q: 'My slides are in PowerPoint, not Google Slides. Does that work?',
      a: 'Yes — use the PowerPoint to Anki page for .pptx files. The result is the same: one card per slide, downloadable as an Anki deck.',
    },
  ],
};

const screenshotToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Turn a photo of your notes into Anki cards',
      href: '/convert/photo-to-anki',
    },
    {
      label: 'Image occlusion in Anki — a guide',
      href: '/answers/image-occlusion-anki',
    },
    { label: 'AI flashcard generator', href: '/ai-flashcard-generator' },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
  ],
  pathname: '/convert/screenshot-to-anki',
  title: 'Screenshot to Anki — clip to flashcards | 2anki',
  description:
    'Upload a screenshot of a slide, chart, or page and get an Anki card. AI reads the image and writes a question and answer you can edit.',
  h1: 'Screenshot to Anki — turn a captured slide into flashcards',
  subhead:
    'Upload a screenshot of a slide, chart, or page. AI reads the image and writes a question and answer you can edit.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Screenshot vs photo — which page do I want?',
      a: 'A screenshot is a digital capture — a slide, a webpage, a PDF on your screen. A photo is taken with your camera — a textbook page, a whiteboard, handwritten notes. Both work here; the camera path lives on the photo to Anki page.',
    },
    {
      q: 'Do I have to retype anything?',
      a: 'No. The AI reads the text in the image and writes the card. You edit only what you want to change.',
    },
    {
      q: 'Can I hide part of a diagram instead of a plain question and answer?',
      a: 'For labelled diagrams where you want to blank out one region at a time, use image occlusion in Anki.',
    },
    {
      q: 'What if the card comes out wrong?',
      a: 'Edit it before downloading. The question and answer are text fields — rewrite them, and re-upload a cleaner crop if the AI misread the image.',
    },
    {
      q: 'Is it free?',
      a: 'You can convert on the free plan up to the monthly card limit. Heavier use and larger uploads are covered by a subscription.',
    },
  ],
};

const googleSheetsToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Convert an Excel spreadsheet to Anki',
      href: '/convert/excel-to-anki',
    },
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    {
      label: 'Convert Notion tables to Anki',
      href: '/convert/notion-tables-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/google-sheets-to-anki',
  title: 'Google Sheets to Anki — rows into cards | 2anki',
  description:
    'Download a Google Sheet as .csv or .xlsx, upload it, and get an Anki deck. Each row becomes a card — pick which columns are front and back.',
  h1: 'Google Sheets to Anki — turn spreadsheet rows into flashcards',
  subhead:
    'Download your sheet as .csv or .xlsx, upload it, and download a .apkg deck. Each row becomes a card, columns you pick.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Do I need a Google Sheets add-on or plugin?',
      a: "No. You export the sheet as a .csv or .xlsx from the built-in File → Download menu and upload that file. There's nothing to install in Sheets or in Anki.",
    },
    {
      q: 'Which export format should I choose, .csv or .xlsx?',
      a: "Either works. .csv is the simplest — plain text, one row per card. Choose .xlsx if your sheet already has the columns arranged the way you want and you'd rather keep the spreadsheet structure. Both land as the same deck.",
    },
    {
      q: 'Can I pick which columns become the front and back?',
      a: "Yes. After upload you map columns to the card's front and back, so it doesn't matter which order they sit in your sheet. Extra columns can be left out or kept as notes.",
    },
    {
      q: 'Does each row really become one card?',
      a: 'Yes — one row in, one card out. A 200-row vocabulary sheet gives you a 200-card deck.',
    },
    {
      q: 'Can I convert an Excel file the same way?',
      a: 'Yes. The .xlsx path is identical whether the file came from Google Sheets or Excel.',
    },
  ],
};

const txtToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    {
      label: 'Convert a CSV or Excel sheet to Anki',
      href: '/convert/csv-to-anki',
    },
    {
      label: 'Lecture notes to Anki — a guide',
      href: '/answers/lecture-notes-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/txt-to-anki',
  title: 'Text file to Anki — .txt into flashcards | 2anki',
  description:
    'Upload a plain text or Markdown file and download an Anki deck. Question-and-answer lines become cards you can edit in Anki in seconds.',
  h1: 'Text file to Anki — turn a plain .txt list into flashcards',
  subhead:
    'Upload a plain .txt or .md file and download a .apkg deck. Term-and-definition lines become cards you can edit in Anki.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How should I format each line in the .txt file?',
      a: "Put the term and its meaning on one line, separated by ' - ' or ' = ' (a space on each side), or by a Tab. For example: 'Mitochondria - the powerhouse of the cell'. Each line becomes one card.",
    },
    {
      q: 'Will plain paragraphs of notes become cards?',
      a: "No. A line needs a separator (' - ', ' = ', or a Tab) to split into a front and back. A prose line with no separator is skipped instead of becoming a blank card. If you have running notes, add the separator or use a bullet structure.",
    },
    {
      q: 'Can I make cloze deletion cards from a text file?',
      a: 'Yes. Wrap a word in backticks, like `photosynthesis`, or leave a blank as ___, and that line converts to a cloze card instead of a front/back card.',
    },
    {
      q: 'What names the deck?',
      a: "The filename. 'Spanish Verbs.txt' becomes a deck called Spanish Verbs. If the file starts with a Markdown heading, that heading is used instead.",
    },
    {
      q: 'Is .md any different from .txt?',
      a: 'No — plain text and Markdown go through the same path. A .md file also supports bullet-list cards, where a top-level bullet is the front and a nested bullet under it is the back.',
    },
  ],
};

const onenoteToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'Convert a Word document to Anki', href: '/convert/word-to-anki' },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    {
      label: 'Handwritten notes to Anki — a guide',
      href: '/answers/handwritten-notes-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/onenote-to-anki',
  title: 'OneNote to Anki — notebook into cards | 2anki',
  description:
    'Export a OneNote page to PDF or Word, upload it, and get an Anki deck. Headings become card fronts and the body becomes the back.',
  h1: 'OneNote to Anki — turn a notebook page into flashcards',
  subhead:
    'Export a OneNote page to PDF or Word, upload it, and download a .apkg deck. Headings become card fronts, the body the back.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Can I export directly from OneNote to Anki?',
      a: "Not directly — OneNote has no Anki export. Export the page to PDF or Word first, then upload that file to 2anki to get an Anki deck. It's one extra step and takes a few seconds in OneNote's File menu.",
    },
    {
      q: 'Should I export as PDF or Word?',
      a: "Either works. Word (.docx) tends to preserve headings and lists more reliably, which gives cleaner card splits. PDF is fine when Word export isn't available. Try Word first if your page has clear headings.",
    },
    {
      q: 'How do my OneNote headings become cards?',
      a: "Each heading becomes the front of a card and the text beneath it becomes the back. Pages you've structured with headings and short sections convert into the most useful decks; unstructured pages give the converter less to work with.",
    },
    {
      q: 'Will my handwritten OneNote notes convert?',
      a: "No. Ink and handwriting export as images, not text, so the words can't be read into cards. Only typed text converts. If your notes are handwritten, the OneNote page won't produce readable card content.",
    },
    {
      q: 'What file do I get back?',
      a: 'An .apkg file. Open it in Anki on desktop or mobile, or sync it through AnkiWeb. No manual card entry — the deck is ready to study.',
    },
  ],
};

const evernoteToAnki: LandingCopy = {
  relatedLinks: [
    { label: 'Convert an HTML file to Anki', href: '/convert/html-to-anki' },
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    { label: 'Convert a Word document to Anki', href: '/convert/word-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/evernote-to-anki',
  title: 'Evernote to Anki — notes into flashcards | 2anki',
  description:
    'Export Evernote notes to HTML, upload the file, and download an Anki deck. Your headings and lists become cards that open clean in Anki.',
  h1: 'Evernote to Anki — turn exported notes into flashcards',
  subhead:
    'Export your Evernote notes to HTML, upload the file, and download a .apkg deck. Headings and lists become cards.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'How do I export Evernote notes to Anki?',
      a: 'Export the note from the Evernote desktop app as HTML (select the note, right-click, Export, choose HTML). Upload the .html file to 2anki and download an .apkg deck you import into Anki.',
    },
    {
      q: "Does 2anki read Evernote's .enex export?",
      a: "Not directly — the .enex format isn't supported. Export your notes as HTML instead. If your Evernote version only offers ENEX, open the note in the web view and save it as HTML from your browser, then upload that file.",
    },
    {
      q: 'Will images from my Evernote notes come across?',
      a: 'Yes, when you upload them with the HTML. Exporting a note with images gives you an .html file plus an attachments folder — zip them together and upload the zip, and the images embed in the cards.',
    },
    {
      q: 'Why did my note become one card instead of many?',
      a: "Cards come from structure. A note that's one long block of prose has no front/back split to work from. Break it into headings and lists, write Q: and A: lines, or use the AI mode to generate question-and-answer cards from the text.",
    },
    {
      q: 'Do I need an Anki add-on to import the deck?',
      a: 'No. 2anki gives you a standard .apkg file. Open it with File → Import in Anki, or double-click it, and the cards load into a new deck. It works on desktop Anki and syncs to AnkiWeb.',
    },
  ],
};

const googleDocsToAnki: LandingCopy = {
  relatedLinks: [
    {
      label: 'Google Docs to Anki — a step-by-step guide',
      href: '/answers/google-docs-to-anki',
    },
    { label: 'Convert a Word document to Anki', href: '/convert/word-to-anki' },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/convert/google-docs-to-anki',
  title: 'Google Docs to Anki — docs to a deck | 2anki',
  description:
    'Turn a Google Doc into an Anki deck. Download as Word or Markdown, upload, and get a .apkg — headings name decks, images embed, tables become cards.',
  h1: 'Google Docs to Anki — convert docs to flashcards',
  subhead:
    'Download your doc as Word or Markdown, upload it, and download a .apkg deck. Headings name decks, images embed, tables become cards.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Can I connect Google Docs to 2anki directly?',
      a: 'No. Download the doc as Word (.docx) or Markdown first — File → Download in Google Docs — then upload the file. It converts the same way as any Word or Markdown upload.',
    },
    {
      q: 'Do images from my Google Doc come across?',
      a: 'Yes, when you export as Word (.docx). Images embed directly in the cards. For an image-heavy doc, use the Word export rather than Markdown, which drops images.',
    },
    {
      q: 'Will a two-column table become flashcards?',
      a: 'Yes. A term-and-definition table converts one card per row — term on the front, definition on the back. Export as Word to keep the table structure intact.',
    },
    {
      q: 'Do I need to install an add-on in Anki?',
      a: 'No. 2anki produces a standard .apkg file. Double-click it in Anki and the deck imports — no add-on required.',
    },
    {
      q: 'Is Google Docs to Anki free?',
      a: 'The free plan covers your first 100 cards a month. Larger decks and unlimited monthly cards are on the paid plan.',
    },
  ],
};

export const CONVERT_LANDING_PAGES: ReadonlyMap<string, LandingCopy> = new Map([
  ['notion-to-anki', notionToAnki],
  ['pdf-to-anki', pdfToAnki],
  ['markdown-to-anki', markdownToAnki],
  ['csv-to-anki', csvToAnki],
  ['html-to-anki', htmlToAnki],
  ['apkg-to-csv', apkgToCsv],
  ['notion-tables-to-anki', notionTablesToAnki],
  ['brainscape-to-anki', brainscapeToAnki],
  ['lingvist-to-anki', lingvistToAnki],
  ['studystack-to-anki', studystackToAnki],
  ['pleco-to-anki', plecoToAnki],
  ['zorbi-to-anki', zorbiToAnki],
  ['language-reactor-to-anki', languageReactorToAnki],
  ['epub-to-anki', epubToAnki],
  ['kindle-to-anki', kindleToAnki],
  ['excel-to-anki', excelToAnki],
  ['word-to-anki', wordToAnki],
  ['obsidian-to-anki', obsidianToAnki],
  ['photo-to-anki', photoToAnki],
  ['google-slides-to-anki', googleSlidesToAnki],
  ['screenshot-to-anki', screenshotToAnki],
  ['google-sheets-to-anki', googleSheetsToAnki],
  ['txt-to-anki', txtToAnki],
  ['onenote-to-anki', onenoteToAnki],
  ['evernote-to-anki', evernoteToAnki],
  ['google-docs-to-anki', googleDocsToAnki],
]);
