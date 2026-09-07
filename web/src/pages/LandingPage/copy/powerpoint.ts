import type { LandingCopy } from '../types';

const powerpointCopy: LandingCopy = {
  alternates: [
    { hreflang: 'en', href: 'https://2anki.net/powerpoint-to-anki/' },
    { hreflang: 'de', href: 'https://2anki.net/powerpoint-zu-anki/' },
    { hreflang: 'x-default', href: 'https://2anki.net/powerpoint-to-anki/' },
  ],
  relatedLinks: [
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    {
      label: 'Turn medical lecture slides into Anki cards',
      href: '/anki-from-medical-lecture-slides',
    },
    {
      label: 'Convert GoodNotes notebooks to Anki',
      href: '/goodnotes-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/powerpoint-to-anki',
  title: 'PowerPoint to Anki — turn slides into flashcards | 2anki',
  description:
    'Upload a .pptx and 2anki turns the text on your slides into an Anki deck. Works with Google Slides exports too.',
  h1: 'Make Anki flashcards from a PowerPoint',
  subhead:
    'Drop a .pptx and 2anki reads the text on your slides and builds an Anki deck you can edit.',
  faqs: [
    {
      q: 'Which slide content becomes a card?',
      a: 'The text on each slide — titles, bullets, and body text. 2anki reads it and builds cards you can edit and rearrange in Anki afterward.',
    },
    {
      q: 'Do speaker notes come across?',
      a: '2anki reads the text on the slides themselves, so notes that live only in the speaker-notes pane are not picked up. Put anything you want on a card onto the slide before you upload.',
    },
    {
      q: 'I made my slides in Google Slides — does that work?',
      a: 'Yes. In Google Slides choose File, then Download, then Microsoft PowerPoint (.pptx). Drop that file here and it converts the same way as a native PowerPoint.',
    },
    {
      q: 'What happens to image-only slides?',
      a: 'Slides with no text — a full-bleed diagram or photo — have nothing for us to read, so they produce no card. Add a title or a line of notes to that slide if you want it to become a card.',
    },
  ],
};

export default powerpointCopy;
