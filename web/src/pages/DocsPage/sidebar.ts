export interface SidebarItem {
  label: string;
  slug: string;
  href?: string;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export const sidebar: SidebarGroup[] = [
  {
    label: 'Start here',
    items: [
      { label: 'What is 2anki?', slug: 'start-here/what-is-2anki' },
      {
        label: 'Connect Notion in 5 minutes',
        slug: 'start-here/connect-notion',
      },
      { label: 'Upload a file instead', slug: 'start-here/upload-a-file' },
      { label: 'Open your deck in Anki', slug: 'start-here/open-in-anki' },
      {
        label: 'Import an Anki deck into Notion',
        slug: 'start-here/import-from-anki',
      },
      { label: 'Share a deck with a link', slug: 'start-here/share-a-deck' },
      {
        label: 'Use 2anki inside Claude or ChatGPT',
        slug: 'start-here/use-in-claude',
      },
    ],
  },
  {
    label: 'Make better cards',
    items: [
      { label: 'Card options', slug: 'cards/card-options' },
      { label: 'Card types', slug: 'cards/card-types' },
      { label: 'Update without duplicates', slug: 'cards/duplicate-cards' },
      { label: 'Multiple choice questions', slug: 'cards/mcq' },
      { label: 'Overlapping cloze', slug: 'cards/overlapping-cloze' },
      { label: 'Notion blocks we support', slug: 'cards/notion-blocks' },
      { label: 'What is a deck?', slug: 'cards/decks' },
      { label: 'Parser rules', slug: 'cards/parser-rules' },
      {
        label: 'Notion → Anki for Japanese',
        slug: 'cards/notion-to-anki-japanese',
      },
      { label: 'AI flashcard generation', slug: 'cards/ai-flashcards' },
      { label: 'Image occlusion', slug: 'cards/image-occlusion' },
      { label: 'Photo to deck', slug: 'cards/photo-to-deck' },
      { label: 'Mind maps', slug: 'cards/mind-maps' },
      { label: 'Note types and templates', slug: 'cards/templates' },
      { label: 'Markdown and Obsidian', slug: 'cards/markdown' },
      { label: 'HTML', slug: 'cards/html' },
      {
        label: 'Edit cards before downloading',
        slug: 'cards/edit-before-download',
      },
    ],
  },
  {
    label: 'Sync with Notion',
    items: [
      { label: 'How sync works', slug: 'sync/how-it-works' },
      { label: 'See your study stats', slug: 'sync/study-stats' },
      { label: 'Review your decks in the browser', slug: 'sync/review-cards' },
      {
        label: 'Send your reviews back to Notion',
        slug: 'sync/review-export',
      },
      { label: 'When sync gets stuck', slug: 'sync/troubleshooting' },
    ],
  },
  {
    label: 'When something breaks',
    items: [
      { label: 'Common problems', slug: 'help/common-problems' },
      { label: 'Limits and quotas', slug: 'help/limits' },
      { label: 'Report a bug', slug: 'help/bug-report' },
      { label: 'Contact us', slug: 'help/contact' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { label: 'Glossary', slug: 'reference/glossary' },
      { label: 'File formats', slug: 'reference/file-formats' },
      { label: 'Short plans and passes', slug: 'reference/plans' },
      { label: 'Chat — study assistant', slug: 'reference/chat' },
      { label: 'Print or export to PDF', slug: 'reference/print-export' },
      { label: 'Self-hosting', slug: 'reference/self-hosting' },
      { label: 'API access', slug: 'reference/api' },
      { label: 'MCP connector', slug: 'reference/mcp' },
      { label: 'Privacy policy', slug: 'reference/privacy' },
      { label: 'Terms of service', slug: 'reference/terms' },
    ],
  },
  {
    label: 'Links',
    items: [
      {
        label: 'Official Anki',
        slug: 'links/anki',
        href: 'https://apps.ankiweb.net/',
      },
      { label: 'Community', slug: 'links/community' },
    ],
  },
];

export const redirects: Record<string, string> = {
  'guides/introduction': 'start-here/what-is-2anki',
  'guides/getting-started': 'start-here/connect-notion',
  'features/notion-support': 'cards/notion-blocks',
  'features/markdown': 'cards/markdown',
  'features/html': 'cards/html',
  'features/csv': 'reference/file-formats',
  'features/xlsx': 'reference/file-formats',
  'features/zip': 'reference/file-formats',
  'features/tsv': 'reference/file-formats',
  'features/pdf': 'reference/file-formats',
  'features/ppt': 'reference/file-formats',
  'troubleshooting/common-problems': 'help/common-problems',
  'troubleshooting/limits': 'help/limits',
  'troubleshooting/bug-report': 'help/bug-report',
  'troubleshooting/contact': 'help/contact',
  'troubleshooting/faq': 'help/common-problems',
  'advanced/self-hosting': 'reference/self-hosting',
  'advanced/napi': 'reference/api',
  'advanced/domain': 'reference/glossary',
  'advanced/terminology': 'reference/glossary',
  'advanced/strategy': 'start-here/what-is-2anki',
  'links/youtube': 'links/community',
  'links/support': 'help/contact',
  'misc/privacy-policy': 'reference/privacy',
  'misc/terms-of-service': 'reference/terms',
};

export function findAdjacent(slug: string) {
  const flat: SidebarItem[] = sidebar
    .flatMap((group) => group.items)
    .filter((item) => !item.href);
  const index = flat.findIndex((item) => item.slug === slug);
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index >= 0 && index < flat.length - 1 ? flat[index + 1] : null,
  };
}

export function findGroupForSlug(slug: string): SidebarGroup | null {
  return (
    sidebar.find((group) => group.items.some((item) => item.slug === slug)) ??
    null
  );
}

// Group headers aren't per-page docs, so the German mirror can't carry them.
// Translate them here; item labels localize from each page's frontmatter title.
const groupLabelDe: Record<string, string> = {
  'Start here': "Los geht's",
  'Make better cards': 'Bessere Karten erstellen',
  'Sync with Notion': 'Mit Notion synchronisieren',
  'When something breaks': 'Wenn etwas nicht klappt',
  Reference: 'Referenz',
  Links: 'Links',
};

export function localizeGroupLabel(label: string, language?: string): string {
  if (language === 'de' && Object.hasOwn(groupLabelDe, label)) {
    return groupLabelDe[label];
  }
  return label;
}
