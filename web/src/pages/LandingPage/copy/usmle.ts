import type { LandingCopy } from '../types';

const usmleCopy: LandingCopy = {
  relatedLinks: [
    {
      label: 'Make nursing flashcards from lecture slides',
      href: '/nursing-flashcards',
    },
    {
      label: 'Turn medical lecture slides into Anki cards',
      href: '/anki-from-medical-lecture-slides',
    },
    {
      label: 'Turn your First Aid notes into Step 1 cards',
      href: '/step1-anki',
    },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/usmle-anki',
  title: 'USMLE Anki decks from your own notes — 2anki',
  description:
    'Upload lecture slides, First Aid exports, or any PDF. Get a spaced repetition-ready Anki deck for USMLE Step 1 and Step 2. | 2anki',
  h1: 'USMLE Step 1 and Step 2 decks from your own notes',
  subhead:
    'Upload lecture slides, First Aid exports, or any PDF. High-yield cards, spaced repetition-ready.',
  whatComesAcross: [
    {
      title: 'Diagrams',
      body: 'Diagrams embedded in your slides come across as images inside the card, so you review them in context.',
    },
    {
      title: 'Image occlusion cards',
      body: 'Image occlusion is a native Anki feature — after import, use the Anki image occlusion editor to mask labels directly on your diagrams.',
    },
    {
      title: 'Slide titles',
      body: 'In a text slide PDF, each slide becomes a card, with the slide title on the front and its bullets on the back.',
    },
    {
      title: 'Nested lists',
      body: "In a text slide PDF, nested bullets stay on the back of their slide's card, in the order you wrote them, so pathophysiology steps and differential diagnosis lists read as one answer.",
    },
  ],
  faqs: [
    {
      q: 'Do scanned PDFs work?',
      a: 'Only if the scan has a text layer from OCR. Slide exports from PowerPoint or Keynote always have a text layer. If you scanned paper notes with a phone, run them through an OCR tool first — macOS Preview and Adobe Acrobat both do this.',
    },
    {
      q: 'Can it produce image occlusion cards?',
      a: "Image occlusion is a native Anki feature built into the card editor — it's not something 2anki builds during conversion. What 2anki does is bring your diagrams across as images. Open the resulting deck in Anki, select an image card, and use Anki's image occlusion tool to add the masks.",
    },
    {
      q: 'Can it handle a full course of slides?',
      a: "Yes. Upload one block at a time — one module, one week, one organ system — rather than an entire year's worth of slides in one file. Anki handles 500-card decks far better than 5,000-card ones, and smaller decks are easier to schedule and share.",
    },
    {
      q: 'How is this different from Quizlet?',
      a: 'Anki uses a spaced repetition algorithm that schedules each card based on how well you remembered it, so high-yield cards you struggle with come back sooner. Quizlet offers flash-card practice but does not schedule cards the same way. If your program or study group uses Anki, 2anki keeps your decks in the same ecosystem.',
    },
  ],
};

export default usmleCopy;
