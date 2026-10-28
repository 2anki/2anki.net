import type { LandingCopy } from '../types';

const nursingCopy: LandingCopy = {
  relatedLinks: [
    { label: 'Build USMLE Anki decks from your notes', href: '/usmle-anki' },
    {
      label: 'Turn medical lecture slides into Anki cards',
      href: '/anki-from-medical-lecture-slides',
    },
    {
      label: 'Make NCLEX Anki cards from your review notes',
      href: '/nclex-anki',
    },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/nursing-flashcards',
  title: 'Anki flashcards from nursing lecture slides and notes — 2anki',
  description:
    'Drop a PDF or Notion export of your nursing notes. 2anki pulls out the terms, medications, and procedures as spaced repetition-ready Anki cards. | 2anki',
  h1: 'Anki flashcards from nursing lecture slides and notes',
  subhead:
    'Drop a PDF or Notion export. 2anki pulls out the terms, medications, and procedures.',
  whatComesAcross: [
    {
      title: 'Diagrams',
      body: 'Anatomy and clinical diagrams embedded in your slides come across as images inside the card.',
    },
    {
      title: 'Image occlusion cards',
      body: 'Image occlusion is a native Anki feature — after import, use the Anki image occlusion editor to mask labels on anatomy diagrams.',
    },
    {
      title: 'Bold and italic text',
      body: 'Bolded drug names, italicised terms, and clinical emphasis carry through so the formatting you made guides your review.',
    },
    {
      title: 'Nested lists',
      body: 'Nested bullets stay on the back of the card above them, in the order you wrote them, so the steps of a nursing procedure or care plan read as one answer.',
    },
  ],
  faqs: [
    {
      q: 'Do scanned PDFs work?',
      a: 'Only if the scan has a text layer from OCR. PDFs exported directly from a slide application always have a text layer. If you scanned printed handouts, run them through an OCR tool first — macOS Preview and Adobe Acrobat both do this.',
    },
    {
      q: 'Can it produce image occlusion cards?',
      a: "Image occlusion is a native Anki feature built into the card editor. 2anki brings your diagrams across as images; you then open the resulting deck in Anki and use Anki's image occlusion tool to add label masks to anatomy illustrations.",
    },
    {
      q: 'Can it handle a full semester of nursing slides?',
      a: 'Yes. Upload one module or one topic at a time rather than the whole semester in one file. Smaller decks are easier to schedule, easier to review, and Anki handles 500-card decks more smoothly than 5,000-card ones.',
    },
    {
      q: 'How is this different from Quizlet?',
      a: 'Anki uses spaced repetition to schedule each card based on your recall — cards you find harder come back sooner. Quizlet offers flash-card practice but schedules differently. Many nursing programs and study groups coordinate around Anki decks, so 2anki keeps your cards in the same ecosystem.',
    },
  ],
};

export default nursingCopy;
