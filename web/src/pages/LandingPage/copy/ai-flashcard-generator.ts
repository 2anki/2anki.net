import type { LandingCopy } from '../types';

const aiFlashcardGeneratorCopy: LandingCopy = {
  relatedLinks: [
    { label: 'Turn a photo of your notes into cards', href: '/photo-to-deck' },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    { label: 'See plans and AI credits', href: '/pricing' },
  ],
  pathname: '/ai-flashcard-generator',
  title: 'AI flashcard generator for Anki: your notes in, cards out | 2anki',
  description:
    'Upload a PDF or your notes and Claude writes Anki cards from them. AI cards come with any paid plan, starting with a Day Pass. Converting without AI is free.',
  h1: 'AI flashcards for Anki, written from your notes',
  subhead:
    "Drop a PDF or your notes. On a paid plan, Claude reads the file and writes the cards, starting with a Day Pass. Free accounts get a deck built from the file's headings and lists, up to 100 cards a month.",
  faqs: [
    {
      q: 'What does the AI do?',
      a: 'Claude reads the text in your upload and writes question-and-answer cards from it. It works from your file, not from a topic name, so the cards match what you studied. Turn on "Generate flashcards with Claude AI" in the upload options.',
    },
    {
      q: 'Is the AI free?',
      a: 'AI cards from uploads need a paid plan: a Day Pass, a Week or Semester Pass, or a subscription. Each plan includes AI credits. A free account can turn photos of notes into cards with Photo to Deck, 5 photos a month. Converting a file without AI is free up to 100 cards a month.',
    },
    {
      q: 'Can it make a deck from a topic on its own?',
      a: 'No. Give it your notes, slides or textbook pages and it turns them into cards. With no material there is nothing to check the cards against, so it does not invent them.',
    },
    {
      q: 'Can I write cards in a chat instead?',
      a: 'Yes. On any paid plan, the study chat turns text you paste into cards you can refine before you download the deck.',
    },
  ],
};

export default aiFlashcardGeneratorCopy;
