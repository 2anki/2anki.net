import type { LandingCopy } from '../types';

const ankiToNotionCopy: LandingCopy = {
  relatedLinks: [
    { label: 'Convert Notion pages to Anki', href: '/notion-to-anki' },
    { label: 'Export an Anki deck to CSV', href: '/convert/apkg-to-csv' },
    {
      label: 'Convert Notion tables to Anki',
      href: '/convert/notion-tables-to-anki',
    },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/anki-to-notion',
  title: 'Anki to Notion — free import, no add-on | 2anki',
  description:
    'Import any Anki deck into Notion. Upload your .apkg file and get every card as a Notion toggle. Free — up to 1 000 cards per import, no add-on required.',
  h1: 'Import Anki decks into Notion in one click.',
  subhead:
    'Upload an .apkg file. Get every card as a toggle in a Notion page you can study, search, and edit.',
  ctaLabel: 'Start free import',
  ctaHref: '/register?source=/anki-to-notion',
  // Deck in, Notion page out — the opposite of the shared steps, which end with
  // "open the .apkg in Anki". This page never produces one.
  steps: [
    {
      title: 'Upload your .apkg',
      body: 'Any Anki deck file, yours or a shared one.',
    },
    {
      title: 'Pick a Notion page',
      body: 'Connect Notion and choose where the cards land.',
    },
    {
      title: 'Study it in Notion',
      body: 'Every card becomes a toggle you can search and edit.',
    },
  ],
  formats: ['.apkg in', 'Notion toggles out'],
  whatComesAcross: [
    {
      title: 'Card fronts and backs',
      body: 'Each card becomes a toggle heading (front) with the back as its body.',
    },
    { title: 'Images', body: 'Images embed inline inside the toggle.' },
    {
      title: 'Cloze deletions',
      body: 'Cloze answers stay wrapped in {{...}} so they remain readable.',
    },
    {
      title: 'Tags',
      body: 'Card tags appear as italicised text at the bottom of each toggle.',
    },
    { title: 'Subdecks', body: 'Each subdeck becomes a nested Notion page.' },
  ],
  faqs: [
    {
      q: 'Do I need an add-on for Notion or Anki?',
      a: 'No. You upload your .apkg file on 2anki.net and we write the cards into a Notion page you choose. Nothing to install on either side.',
    },
    {
      q: 'What survives the import?',
      a: 'Card fronts, backs, images, cloze deletions, tags, and subdeck structure. Card styling (custom CSS) does not come across — Notion pages do not support it.',
    },
    {
      q: 'Will edits in Notion sync back to Anki?',
      a: 'A one-time import is a snapshot. Changes do not flow back to Anki automatically.',
    },
    {
      q: 'Is it free?',
      a: 'Yes. Free covers up to 1 000 cards per import. For larger decks, upgrade to Unlimited or split your deck in Anki (File → Export → Selected Deck) and run two imports.',
    },
    {
      q: 'How big can my deck be?',
      a: 'Free: 1 000 cards per import. Unlimited: up to 5,000 cards per import. For very large decks we split across multiple Notion pages automatically.',
    },
  ],
};

export default ankiToNotionCopy;
