import type { LandingCopy } from '../types';
import { ankiFidelityProof } from './ankiFidelityProof';

const notionCopy: LandingCopy = {
  galleryBadge: true,
  alternates: [
    { hreflang: 'en', href: 'https://2anki.net/notion-to-anki/' },
    { hreflang: 'de', href: 'https://2anki.net/notion-zu-anki/' },
    { hreflang: 'x-default', href: 'https://2anki.net/notion-to-anki/' },
  ],
  relatedLinks: [
    {
      label: 'Convert Notion tables to Anki',
      href: '/convert/notion-tables-to-anki',
    },
    { label: 'Keep decks in sync with Notion', href: '/pricing' },
    {
      label: 'Which Notion blocks convert',
      href: '/documentation/cards/notion-blocks',
    },
    {
      label: 'Convert Markdown and Obsidian notes to Anki',
      href: '/markdown-to-anki',
    },
    { label: 'Convert a PDF to Anki', href: '/pdf-to-anki' },
    { label: 'Anki for Japanese learners', href: '/anki-for-japanese' },
    { label: 'Browse every converter', href: '/convert' },
  ],
  pathname: '/notion-to-anki',
  title: 'Notion to Anki — decks that open clean in Anki | 2anki',
  description:
    'Convert any Notion page to an Anki deck that opens clean — cloze stays clickable, images render, toggles become cards. Paste a link, get a .apkg.',
  h1: 'Notion to Anki — free, no add-on required',
  subhead:
    'Connect Notion once, paste any page link, get a .apkg deck. No software to install.',
  whatComesAcross: ankiFidelityProof,
  faqs: [
    {
      q: 'Does this work with toggles and callouts?',
      a: "Yes. Toggles become front/back cards. Strikethrough text in the page body becomes a tag on every card in that deck. If a block type isn't handled the way you'd like, send the page to support@2anki.net and we'll take a look.",
    },
    {
      q: 'Do I need a Notion integration token?',
      a: 'Yes — connect Notion once on the upload page. We use the token only to read the pages you pick, and you can revoke it from your Notion settings any time.',
    },
    {
      q: 'What happens to images and code blocks?',
      a: "Both come across. Images embed in the card, code blocks keep their formatting. Anything we can't fetch is replaced with a short note so the card still works.",
    },
    {
      q: 'Will it sync when I edit the Notion page later?',
      a: 'A one-time conversion is a snapshot. Re-paste the link to make a fresh deck. If you want changes to flow automatically, see Auto Sync on the pricing page — it polls Notion every few minutes.',
    },
  ],
};

export default notionCopy;
