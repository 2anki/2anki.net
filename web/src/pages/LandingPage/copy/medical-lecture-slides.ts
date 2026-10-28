import type { LandingCopy } from '../types';

const medicalLectureSlidesCopy: LandingCopy = {
  relatedLinks: [
    { label: 'Convert PowerPoint slides to Anki', href: '/powerpoint-to-anki' },
    { label: 'Build USMLE Anki decks from your notes', href: '/usmle-anki' },
    {
      label: 'Make nursing flashcards from lecture slides',
      href: '/nursing-flashcards',
    },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/anki-from-medical-lecture-slides',
  title: 'Turn medical lecture slides into Anki cards — 2anki',
  description:
    'Upload a PDF of your medical lecture slides. Each text slide becomes an Anki card, with the title on the front and its bullets on the back. | 2anki',
  h1: 'Turn lecture slides into Anki cards',
  subhead:
    'Upload a PDF of your slides — each text slide becomes a card, with the slide title on the front and its bullets on the back.',
  whatComesAcross: [
    {
      title: 'Diagrams',
      body: 'Diagrams embedded in your slides come across as images inside the card, so clinical illustrations stay attached to the relevant concept.',
    },
    {
      title: 'Image occlusion cards',
      body: 'Image occlusion is a native Anki feature — after import, use the Anki image occlusion editor to mask labels on any diagram that came across.',
    },
    {
      title: 'Slide numbers',
      body: 'Bare slide numbers like "12" or "3 of 40" are left off your cards, so the back holds only what the slide teaches.',
    },
    {
      title: 'Nested lists',
      body: "Nested bullets stay on the back of their slide's card, in the order you wrote them, so a multi-step clinical process or a classification system reads as one answer.",
    },
  ],
  faqs: [
    {
      q: 'Do scanned PDFs work?',
      a: 'Only if the scan has a text layer from OCR. PDFs exported from PowerPoint or Keynote always have a text layer. If you photographed paper handouts, run them through an OCR tool first — macOS Preview and Adobe Acrobat both do this.',
    },
    {
      q: 'Can it produce image occlusion cards?',
      a: "Image occlusion is a native Anki feature built into the card editor — 2anki doesn't build the masks during conversion. 2anki brings your diagrams across as images. Open the resulting deck in Anki and use Anki's image occlusion tool to add label masks to any diagram.",
    },
    {
      q: 'Can it handle a full course of slides?',
      a: 'Yes. Upload one lecture or one topic block at a time rather than an entire course as a single file. Smaller decks are easier to schedule and review, and Anki performs better with focused 200–500 card decks than with one massive deck.',
    },
    {
      q: 'How is this different from Quizlet?',
      a: 'Anki uses a spaced repetition algorithm that schedules each card based on your recall, so cards you find harder come back sooner. Quizlet offers flash-card practice but uses a different scheduling model. If your program or study group uses Anki, 2anki keeps your lecture notes in the same ecosystem.',
    },
  ],
};

export default medicalLectureSlidesCopy;
