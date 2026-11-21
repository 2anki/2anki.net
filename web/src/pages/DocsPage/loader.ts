import { redirects } from './sidebar';

const modules = import.meta.glob(
  ['./content/**/*.{md,mdx}', '!./content/de/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  }
) as Record<string, string>;

const germanModules = import.meta.glob('./content/de/**/*.{md,mdx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface DocFrontmatter {
  title?: string;
  description?: string;
  template?: string;
}

export type DocLanguage = 'en' | 'de';

export interface LoadedDoc {
  frontmatter: DocFrontmatter;
  body: string;
  sourcePath: string;
  language: DocLanguage;
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function isKeyChar(code: number | undefined): boolean {
  return (
    code !== undefined &&
    ((code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 95 ||
      code === 45)
  );
}

function isKeyStart(code: number | undefined): boolean {
  return (
    code !== undefined &&
    ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95)
  );
}

function parseFrontmatterLine(line: string): [string, string] | null {
  if (line.length === 0 || !isKeyStart(line.codePointAt(0))) return null;
  let i = 1;
  while (i < line.length && isKeyChar(line.codePointAt(i))) i++;
  const key = line.slice(0, i);
  while (i < line.length && line.codePointAt(i) === 32) i++;
  if (i >= line.length || line.codePointAt(i) !== 58) return null;
  i++;
  while (i < line.length && line.codePointAt(i) === 32) i++;
  return [key, unquote(line.slice(i).trim())];
}

function splitLines(input: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.codePointAt(i);
    if (c === 10) {
      const end = i > start && input.codePointAt(i - 1) === 13 ? i - 1 : i;
      lines.push(input.slice(start, end));
      start = i + 1;
    }
  }
  if (start < input.length) lines.push(input.slice(start));
  return lines;
}

type ParsedDoc = Omit<LoadedDoc, 'language'>;

function parseFrontmatter(raw: string, sourcePath: string): ParsedDoc {
  let offset: number;
  if (raw.startsWith('---\n')) offset = 4;
  else if (raw.startsWith('---\r\n')) offset = 5;
  else return { frontmatter: {}, body: raw, sourcePath };

  const closeIdx = raw.indexOf('\n---', offset);
  if (closeIdx === -1) return { frontmatter: {}, body: raw, sourcePath };

  const fmBlock = raw.slice(offset, closeIdx);
  let bodyStart = closeIdx + 4;
  if (raw.codePointAt(bodyStart) === 13) bodyStart++;
  if (raw.codePointAt(bodyStart) === 10) bodyStart++;
  const body = raw.slice(bodyStart);

  const frontmatter: DocFrontmatter = {};
  for (const line of splitLines(fmBlock)) {
    const kv = parseFrontmatterLine(line);
    if (kv) (frontmatter as Record<string, string>)[kv[0]] = kv[1];
  }

  return { frontmatter, body, sourcePath };
}

const ASSET_PATH = /\]\((?:\.\.\/){1,8}assets\/([^)\s]{1,256})\)/g;

function rewriteAssetPaths(body: string): string {
  return body.replaceAll(ASSET_PATH, '](/docs-assets/$1)');
}

function slugFromPath(path: string, prefix: string): string {
  const start = path.startsWith(prefix) ? prefix.length : 0;
  let end = path.length;
  if (path.endsWith('.mdx')) end -= 4;
  else if (path.endsWith('.md')) end -= 3;
  return path.slice(start, end);
}

const SOURCE_ROOT = 'web/src/pages/DocsPage/';

function buildDocs(
  entries: Record<string, string>,
  prefix: string,
  language: DocLanguage
): Record<string, LoadedDoc> {
  const result: Record<string, LoadedDoc> = {};
  for (const [path, raw] of Object.entries(entries)) {
    const slug = slugFromPath(path, prefix);
    const relPath = path.startsWith('./') ? path.slice(2) : path;
    const sourcePath = `${SOURCE_ROOT}${relPath}`;
    const parsed = parseFrontmatter(raw, sourcePath);
    result[slug] = {
      frontmatter: parsed.frontmatter,
      body: rewriteAssetPaths(parsed.body),
      sourcePath,
      language,
    };
  }
  return result;
}

const docs = buildDocs(modules, './content/', 'en');
const germanDocs = buildDocs(germanModules, './content/de/', 'de');

export function resolveSlug(slug: string): string {
  return Object.hasOwn(redirects, slug) ? redirects[slug] : slug;
}

export function loadDoc(slug: string, language?: string): LoadedDoc | null {
  const resolved = resolveSlug(slug);
  if (language === 'de' && Object.hasOwn(germanDocs, resolved)) {
    return germanDocs[resolved];
  }
  return docs[resolved] ?? null;
}

export function hasDoc(slug: string): boolean {
  const resolved = resolveSlug(slug);
  return Object.hasOwn(docs, resolved);
}

export interface SlugDoc extends LoadedDoc {
  slug: string;
}

export function getAllDocs(): SlugDoc[] {
  return Object.entries(docs).map(([slug, doc]) => ({ slug, ...doc }));
}
