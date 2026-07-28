import path from 'path';

export const TEMPLATE_DIR = path.join(__dirname, '../templates');

const PRODUCTION_ORIGINS = [
  'https://dev.notion2anki.alemayhu.com',
  'https://dev.2anki.net',
  'https://notion.2anki.com',
  'https://2anki.net',
  'https://2anki.com',
  'https://notion.2anki.net',
  'https://dev.notion.2anki.net',
  'https://notion.2anki.net/',
  'https://staging.2anki.net',
  'https://templates.2anki.net/',
  'https://app.2anki.net',
];

const LOCAL_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:2020',
];

export const ALLOWED_ORIGINS = [
  ...PRODUCTION_ORIGINS,
  ...(process.env.LOCAL_DEV ? LOCAL_DEV_ORIGINS : []),
];

export function resolvePath(dir: string, x: string) {
  const p = path
    .resolve(path.join(dir, x))
    .replace(/app.asar/g, 'app.asar.unpacked');
  return x.endsWith('/') ? `${p}/` : p;
}

export const CLEANUP_AGE_SECONDS = 7200;

// How long an unrevoked deck share keeps pinning its upload in storage after
// the last view (or creation, if never viewed). Uniform across private and
// public shares — gating only the public path would leave the private-share
// pin wide open (#3831).
export const SHARE_INACTIVITY_TTL_DAYS = 90;

export const ONE_HOUR = 60 * 60 * 1000;

export const BUILD_DIR = path.join(__dirname, '../../web/build');

export const CREATE_DECK_DIR = path.join(__dirname, '../../create_deck/');

export const CREATE_DECK_SCRIPT_PATH = path.join(
  CREATE_DECK_DIR,
  'create_deck.py'
);

export const SUPPORT_EMAIL_ADDRESS = 'support@2anki.net';
export const SUPPORT_CC_ADDRESS = 'alexander@alemayhu.com';
