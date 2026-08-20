const STATIC_PUBLIC_ROUTES = new Set<string>([
  '/',
  '/upload',
  '/pricing',
  '/about',
  '/convert',
  '/notion-marketplace',
]);

const APP_ROUTES = new Set<string>([
  '/login',
  '/register',
  '/forgot',
  '/account',
  '/account/claim',
  '/notion',
  '/search',
  '/downloads',
  '/uploads',
  '/favorites',
  '/import',
  '/ankify',
  '/ankify/setup',
  '/ankify/history',
  '/developers',
  '/settings',
  '/settings/card-options',
  '/card-options',
  '/mindmaps',
  '/chat',
  '/photo-to-deck',
  '/image-occlusion',
  '/print',
  '/debug',
  '/contact',
  '/delete-account',
  '/limit',
  '/security',
  '/status',
  '/whats-new',
  '/documentation',
  '/successful-checkout',
  '/auth/magic',
  '/app',
  '/templates',
  '/templates/new',
]);

const OPS_ROUTES = new Set<string>([
  '/ops',
  '/ops/today',
  '/ops/growth',
  '/ops/system',
  '/ops/errors',
  '/ops/performance',
  '/ops/conversions',
  '/ops/upload-funnel',
  '/ops/business',
  '/ops/showcase',
  '/ops/messages',
  '/ops/commands',
  '/ops/flags',
]);

const LANDING_SLUGS = new Set<string>([
  'notion-to-anki',
  'quizlet-to-anki',
  'markdown-to-anki',
  'pdf-to-anki',
  'anki-to-notion',
  'usmle-anki',
  'step1-anki',
  'nclex-anki',
  'mcat-anki',
  'nursing-flashcards',
  'anki-from-medical-lecture-slides',
  'powerpoint-to-anki',
  'goodnotes-to-anki',
  'ai-flashcard-generator',
  'anki-for-japanese',
]);

const CONVERT_SLUGS = new Set<string>([
  'notion-to-anki',
  'pdf-to-anki',
  'markdown-to-anki',
  'csv-to-anki',
  'html-to-anki',
  'apkg-to-csv',
  'notion-tables-to-anki',
  'brainscape-to-anki',
  'lingvist-to-anki',
  'studystack-to-anki',
  'pleco-to-anki',
  'zorbi-to-anki',
  'language-reactor-to-anki',
  'epub-to-anki',
  'kindle-to-anki',
  'excel-to-anki',
  'word-to-anki',
  'obsidian-to-anki',
  'photo-to-anki',
  'google-slides-to-anki',
  'screenshot-to-anki',
  'google-sheets-to-anki',
  'txt-to-anki',
  'onenote-to-anki',
  'evernote-to-anki',
  'google-docs-to-anki',
]);

const ANSWERS_SLUGS = new Set<string>([
  'convert-notion-to-anki',
  'notion-to-anki-sync',
  'pdf-to-anki',
  'quizlet-to-anki',
  'fsrs-explained',
  'lecture-notes-to-anki',
  'word-to-anki',
  'image-occlusion-anki',
  'google-docs-to-anki',
  'handwritten-notes-to-anki',
  'textbook-to-anki',
  'kindle-highlights-to-anki',
  'language-app-to-anki',
  'obsidian-to-anki',
  'claude-to-anki',
]);

const PARAM_PREFIXES = [
  '/rules/',
  '/preview/',
  '/users/r/',
  '/s/',
  '/mindmaps/',
  '/templates/edit/',
];

const normalizePathname = (pathname: string): string => {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
};

const isLandingPath = (path: string): boolean => {
  const slug = path.replace(/^\//, '');
  return LANDING_SLUGS.has(slug);
};

const isConvertPath = (path: string): boolean => {
  const slug = path.replace(/^\/convert\//, '');
  return path.startsWith('/convert/') && CONVERT_SLUGS.has(slug);
};

const isAnswersPath = (path: string): boolean => {
  const slug = path.replace(/^\/answers\//, '');
  return path.startsWith('/answers/') && ANSWERS_SLUGS.has(slug);
};

const isParamPath = (path: string): boolean =>
  PARAM_PREFIXES.some(
    (prefix) => path.startsWith(prefix) && path.length > prefix.length
  );

const isDocumentationPath = (path: string): boolean =>
  path === '/documentation' || path.startsWith('/documentation/');

export const isKnownAppRoute = (pathname: string): boolean => {
  const path = normalizePathname(pathname);

  if (STATIC_PUBLIC_ROUTES.has(path)) {
    return true;
  }
  if (APP_ROUTES.has(path) || OPS_ROUTES.has(path)) {
    return true;
  }
  if (isDocumentationPath(path)) {
    return true;
  }
  if (isLandingPath(path) || isConvertPath(path) || isAnswersPath(path)) {
    return true;
  }
  return isParamPath(path);
};
