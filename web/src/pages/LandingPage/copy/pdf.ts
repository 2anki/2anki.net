import type { LandingCopy } from '../types';
import { ankiFidelityProof } from './ankiFidelityProof';

const pdfCopy: LandingCopy = {
  alternates: [
    { hreflang: 'en', href: 'https://2anki.net/pdf-to-anki/' },
    { hreflang: 'de', href: 'https://2anki.net/pdf-zu-anki/' },
    { hreflang: 'x-default', href: 'https://2anki.net/pdf-to-anki/' },
  ],
  relatedLinks: [
    { label: 'Convert PowerPoint slides to Anki', href: '/powerpoint-to-anki' },
    {
      label: 'Turn medical lecture slides into Anki cards',
      href: '/anki-from-medical-lecture-slides',
    },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/pdf-to-anki',
  title: 'PDF to Anki — flashcards that work in Anki | 2anki',
  description:
    'Turn a PDF into an Anki deck that imports clean — correct note types, images embedded, headings as decks. Drop a file, get a .apkg.',
  h1: 'Make Anki flashcards from a PDF',
  subhead: "Drop a PDF and we'll pull out the text you can turn into cards.",
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Will it read scanned PDFs?',
      a: 'Only if the scan has a text layer (OCR). Most modern textbooks and slide exports do. If yours is a photo of a page with no text layer, run it through an OCR tool first — macOS Preview and Adobe Acrobat both do this.',
    },
    {
      q: 'How does it pick what becomes a card?',
      a: "Headings become deck and tag names. Bullet points and short paragraphs become card fronts; the next line or indent becomes the back. You can edit the cards in Anki after — we don't lock anything down.",
    },
    {
      q: 'Can I upload a whole textbook?',
      a: 'Yes, but big PDFs take longer and can create huge decks. We recommend uploading one chapter at a time — easier to review, easier to share, and Anki handles 500-card decks better than 50,000-card ones.',
    },
    {
      q: 'What about diagrams and equations?',
      a: 'Diagrams come across as embedded images. Equations rendered as images stay images; equations stored as text need MathJax enabled in your Anki card template to display.',
    },
  ],
};

export default pdfCopy;
