import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import ReactDOMServer from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import { sidebar } from '../src/pages/DocsPage/sidebar';
import {
  buildDocDescription,
  buildDocTitle,
} from '../src/pages/DocsPage/docMeta';
import type { DocFrontmatter } from '../src/pages/DocsPage/loader';
import { rewriteHead } from './prerenderLandingPages';

export const DOCS_CONTENT_DIR = join(
  __dirname,
  '../src/pages/DocsPage/content'
);

const DOCS_HOME_FILE = 'index.mdx';

// The server renders the privacy policy and terms into the shell itself, at
// their current and legacy URLs alike (src/lib/legalPrerender.ts), so those two
// keep a single source for their body and get no static file here.
export const SERVER_RENDERED_DOC_SLUGS: ReadonlySet<string> = new Set([
  'reference/privacy',
  'reference/terms',
]);
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const FRONTMATTER_LINE = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;
const CALLOUT_FENCE = /^:::/;
const ASSET_PATH = /\]\((?:\.\.\/){1,8}assets\/([^)\s]{1,256})\)/g;

// Visible only until React mounts and replaces the root, so it stays plain.
const PRERENDER_STYLE = {
  maxWidth: '48rem',
  margin: '0 auto',
  padding: '1rem',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1.5,
};

interface DocSource {
  frontmatter: DocFrontmatter;
  body: string;
}

function unquote(value: string): string {
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'")) {
    return value.endsWith(first) ? value.slice(1, -1) : value;
  }
  return value;
}

function readDoc(contentDir: string, file: string): DocSource {
  const raw = readFileSync(join(contentDir, file), 'utf8');
  const match = FRONTMATTER.exec(raw);
  const frontmatter: Record<string, string> = {};
  for (const line of (match?.[1] ?? '').split(/\r?\n/)) {
    const kv = FRONTMATTER_LINE.exec(line);
    if (kv != null) {
      frontmatter[kv[1]] = unquote(kv[2].trim());
    }
  }
  const body = match == null ? raw : raw.slice(match[0].length);
  return { frontmatter, body };
}

// The client turns ':::note' fences into callouts; here the fence lines go and
// the text inside stays.
function toStaticMarkdown(body: string): string {
  return body
    .split('\n')
    .filter((line) => !CALLOUT_FENCE.test(line.trim()))
    .join('\n')
    .replaceAll(ASSET_PATH, '](/docs-assets/$1)');
}

function renderMain(children: ReactNode[]): string {
  return ReactDOMServer.renderToStaticMarkup(
    createElement(
      'main',
      { className: 'docs-prerender', style: PRERENDER_STYLE },
      ...children
    )
  );
}

function docBody(doc: DocSource): string {
  const { title, description } = doc.frontmatter;
  return renderMain([
    title ? createElement('h1', { key: 'title' }, title) : null,
    description
      ? createElement('p', { key: 'description' }, description)
      : null,
    createElement(
      Markdown,
      {
        key: 'body',
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeRaw, rehypeSlug],
      },
      toStaticMarkdown(doc.body)
    ),
  ]);
}

function docsHomeBody(doc: DocSource): string {
  const groups = sidebar.map((group) =>
    createElement(
      'section',
      { key: group.label },
      createElement('h2', null, group.label),
      createElement(
        'ul',
        null,
        group.items.map((item) =>
          createElement(
            'li',
            { key: item.slug },
            createElement(
              'a',
              { href: item.href ?? `/documentation/${item.slug}/` },
              item.label
            )
          )
        )
      )
    )
  );
  return renderMain([
    createElement('h1', { key: 'title' }, doc.frontmatter.title ?? ''),
    doc.frontmatter.description
      ? createElement('p', { key: 'description' }, doc.frontmatter.description)
      : null,
    ...groups,
  ]);
}

export function documentationSlugs(): string[] {
  return sidebar
    .flatMap((group) => group.items)
    .filter((item) => item.href == null)
    .map((item) => item.slug)
    .filter((slug) => !SERVER_RENDERED_DOC_SLUGS.has(slug));
}

function writePage(
  buildDir: string,
  source: string,
  pathname: string,
  head: { title: string; description: string },
  body: string
): string {
  const html = rewriteHead(source, {
    pathname,
    title: head.title,
    description: head.description,
    h1: '',
    subhead: '',
    faqs: [],
  }).replace(/<div id="root"><\/div>/, `<div id="root">${body}</div>`);
  const outDir = join(buildDir, pathname.replace(/^\//, ''));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'index.html');
  writeFileSync(outPath, html, 'utf8');
  return outPath;
}

export function emitDocsPages(
  buildDir: string,
  contentDir: string = DOCS_CONTENT_DIR
): string[] {
  const source = readFileSync(join(buildDir, 'index.html'), 'utf8');
  const home = readDoc(contentDir, DOCS_HOME_FILE);
  const emitted = [
    writePage(
      buildDir,
      source,
      '/documentation',
      {
        title: buildDocTitle(),
        description:
          buildDocDescription(home.frontmatter, home.body) ?? buildDocTitle(),
      },
      docsHomeBody(home)
    ),
  ];
  for (const slug of documentationSlugs()) {
    const doc = readDoc(contentDir, `${slug}.md`);
    emitted.push(
      writePage(
        buildDir,
        source,
        `/documentation/${slug}`,
        {
          title: buildDocTitle(doc.frontmatter.title),
          description:
            buildDocDescription(doc.frontmatter, doc.body) ??
            buildDocTitle(doc.frontmatter.title),
        },
        docBody(doc)
      )
    );
  }
  return emitted;
}
