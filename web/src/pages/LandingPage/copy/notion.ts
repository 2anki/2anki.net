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
      label: 'Convert Notion toggles to Anki',
      href: '/convert/notion-toggles-to-anki',
    },
    {
      label: 'Convert a Notion export to Anki',
      href: '/convert/notion-export-to-anki',
    },
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
  h1: 'Notion to Anki — turn pages, toggles, and tables into cards',
  subhead:
    'Connect Notion and paste a page link, or upload an export. Toggles become front-and-back cards. Download a .apkg.',
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
    {
      q: 'Can I convert a Notion export without connecting?',
      a: 'Yes. Export the page from Notion (the … menu, then Export, then HTML), then upload the .zip on the upload page, no connection needed. The Notion export to Anki page has the full walkthrough.',
    },
    {
      q: 'Can I convert a Notion database?',
      a: 'Yes. 2anki turns one row into one card and picks the front and back columns by name, matching headers like Term and Definition, and falling back to the first two columns when it cannot. See the Notion tables to Anki page for how multi-column tables map.',
    },
    {
      q: 'How do I make cloze cards from Notion?',
      a: 'Wrap the answer in inline code in a toggle heading, or write {{c1::...}} there, and 2anki makes a real Anki cloze card where {{c1::...}} stays clickable. Reading a cloze from a toggle content is a separate option that is off by default.',
    },
  ],
};

export default notionCopy;
