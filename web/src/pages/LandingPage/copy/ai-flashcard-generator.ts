import type { LandingCopy } from '../types';

const aiFlashcardGeneratorCopy: LandingCopy = {
  relatedLinks: [
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/ai-flashcard-generator',
  title:
    'AI flashcard generator for Anki — your notes in, real cards out | 2anki',
  description:
    'Turn your own notes into Anki cards. 2anki reads what you upload and builds a deck — no hallucinated cards, no invented facts.',
  h1: 'Turn your notes into Anki cards',
  subhead:
    'Real notes in, real cards out. 2anki builds your deck from what you upload — it never invents facts.',
  faqs: [
    {
      q: 'What does the AI actually do?',
      a: 'The study chat turns text you type or paste into question-and-answer cards. It works from your material — your notes, your definitions, your summary — not from a topic name. Upload conversion is separate and deterministic: it reads the text in your file and lays out cards from it.',
    },
    {
      q: 'Can it generate a deck from a topic on its own?',
      a: "No. We don't invent flashcards or read your images. If you ask it for cards on a subject with no notes, it has nothing to work from. Give it your material and it turns that into cards you can trust.",
    },
    {
      q: 'How do I use the study chat?',
      a: 'Sign in with any paid plan — subscription, day pass, or lifetime — and open the chat. Paste your notes and it returns cards you can refine. Conversion from a file — PDF, PowerPoint, Notion, Markdown — is free and has no message cap.',
    },
    {
      q: 'Why notes-first instead of a one-click generator?',
      a: 'Cards built from your own notes match what you studied, so spaced repetition reinforces the real material instead of plausible-sounding filler. That fidelity is the point.',
    },
  ],
};

export default aiFlashcardGeneratorCopy;
