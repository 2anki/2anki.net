import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { ProtocolError, TimeoutError } from 'puppeteer';
import type { HTTPRequest } from 'puppeteer';
import type { PdfOptions } from '../usecases/apkg/ExportApkgToPdfUseCase';

const PDF_TIMEOUT_MS = 30_000;
const MATHJAX_SETTLE_MS = 2_000;
// Bounds every single DevTools call so a wedged browser surfaces as an error
// instead of holding the request open for puppeteer's 180s default.
const PROTOCOL_TIMEOUT_MS = 90_000;

const MARGIN_VALUES: Record<string, string> = {
  narrow: '0.5cm',
  normal: '1cm',
  wide: '2cm',
};

// Asset names land on disk inside the render directory, so only a flat name
// is allowed: no separators, no traversal.
const SAFE_ASSET_NAME = /^\w[\w.-]*$/;

// The browser going away mid-render (renderer OOM, Chrome dropping the
// DevTools connection, a killed process) surfaces as one of these.
// TargetCloseError and ConnectionClosedError both extend ProtocolError.
const BROWSER_GONE_NAMES = new Set([
  'ProtocolError',
  'TargetCloseError',
  'ConnectionClosedError',
]);
const BROWSER_GONE_MESSAGE =
  /Target closed|Session closed|Connection closed|Page crashed|Browser (has )?disconnected/i;

export const PDF_TOO_BIG_MESSAGE =
  'This deck is too big to print in one go. Split it into smaller decks in Anki and print them one at a time.';

export class PdfRenderTimeoutError extends Error {
  // Set by the export use case so failure analytics can bucket deck size.
  cardCount?: number;

  constructor() {
    super(
      'This deck is too large to turn into a PDF in time. Split it into smaller decks in Anki and print them one at a time.'
    );
    this.name = 'PdfRenderTimeoutError';
  }
}

export class PdfRenderCrashedError extends Error {
  cardCount?: number;

  constructor(public readonly cause?: unknown) {
    super(PDF_TOO_BIG_MESSAGE);
    this.name = 'PdfRenderCrashedError';
  }
}

export function isBrowserGoneError(error: unknown): boolean {
  if (error instanceof ProtocolError) return true;
  if (!(error instanceof Error)) return false;
  return (
    BROWSER_GONE_NAMES.has(error.name) ||
    BROWSER_GONE_MESSAGE.test(error.message)
  );
}

function isProtocolTimeout(error: unknown): boolean {
  return isBrowserGoneError(error) && /timed out/i.test(String(error));
}

export interface PdfDocument {
  html: string;
  // File name → bytes. The HTML references each one by that bare name as a
  // relative `src`, so images load from disk instead of riding in the HTML.
  assets?: ReadonlyMap<string, Buffer>;
}

async function writeDocument(dir: string, doc: PdfDocument): Promise<string> {
  for (const [name, bytes] of doc.assets ?? []) {
    if (!SAFE_ASSET_NAME.test(name)) {
      throw new Error(`Refusing unsafe PDF asset name: ${name}`);
    }
    await writeFile(path.join(dir, name), bytes);
  }
  const htmlPath = path.join(dir, 'index.html');
  await writeFile(htmlPath, withConnectBlock(doc.html), 'utf8');
  return htmlPath;
}

// Request interception never sees WebSocket, fetch-to-ws or other script
// connections, so the page also carries a CSP that forbids them all. Deck
// scripts are already stripped by sanitizeCardHtml; this is the backstop.
const CONNECT_BLOCK =
  '<meta http-equiv="Content-Security-Policy" content="connect-src \'none\'">';

export function withConnectBlock(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head == null) return CONNECT_BLOCK + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + CONNECT_BLOCK + html.slice(at);
}

// The only remote script a PDF page may load: the MathJax build the document
// links to (MATHJAX_CONFIG in ExportApkgToPdfUseCase).
const MATHJAX_PREFIX = 'https://cdn.jsdelivr.net/npm/mathjax@3/';

/**
 * Deck HTML is untrusted, so the render page may load only its own temp
 * directory, inline data, and MathJax. Everything else is aborted: other
 * local files (an iframe on file:///etc/hosts rendered the hosts file) and
 * any other http(s) URL, which would let a deck make the server fetch
 * internal or third-party addresses.
 */
export function guardLocalFiles(dirUrl: string) {
  const dir = new URL(dirUrl);
  const mathjax = new URL(MATHJAX_PREFIX);
  return (request: HTTPRequest): void => {
    if (!isAllowedRenderUrl(request.url(), dir, mathjax)) {
      void request.abort('accessdenied');
      return;
    }
    void request.continue();
  };
}

// Compares parsed URLs, not raw strings: the scheme is case-insensitive, but
// paths are compared exactly, so a differently-cased sibling temp directory
// (another render's) never matches.
function isAllowedRenderUrl(raw: string, dir: URL, mathjax: URL): boolean {
  if (raw === 'about:blank') return true;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  switch (url.protocol) {
    case 'data:':
      return true;
    case 'file:':
      return url.host === dir.host && url.pathname.startsWith(dir.pathname);
    case 'https:':
      return (
        url.origin === mathjax.origin &&
        url.username === '' &&
        url.password === '' &&
        url.pathname.startsWith(mathjax.pathname)
      );
    default:
      return false;
  }
}

export default class PdfRenderService {
  async renderHtml(html: string, options?: PdfOptions): Promise<Buffer> {
    return this.renderDocument({ html }, options);
  }

  // Writes the document to a private temp directory and navigates to it
  // instead of calling page.setContent. setContent ships the whole HTML in a
  // single DevTools message, and Chrome drops the connection on any message
  // over 100 MiB: a deck with a few dozen inlined images crossed that and
  // failed with "TargetCloseError: Protocol error (Page.setDocumentContent)".
  async renderDocument(
    doc: PdfDocument,
    options?: PdfOptions
  ): Promise<Buffer> {
    const dir = await mkdtemp(path.join(os.tmpdir(), '2anki-pdf-'));
    try {
      const htmlPath = await writeDocument(dir, doc);
      return await this.renderFile(htmlPath, dir, options);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async renderFile(
    htmlPath: string,
    dir: string,
    options?: PdfOptions
  ): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: PROTOCOL_TIMEOUT_MS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Container /dev/shm is often 64MB; use /tmp for shared memory.
        '--disable-dev-shm-usage',
      ],
    });
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', guardLocalFiles(`${pathToFileURL(dir).href}/`));
      await page.goto(pathToFileURL(htmlPath).href, {
        waitUntil: 'load',
        timeout: PDF_TIMEOUT_MS,
      });
      await page.waitForFunction(
        `new Promise(function(resolve) {
          var start = Date.now();
          function check() {
            if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
              window.MathJax.typesetPromise().then(function() { resolve(true); }).catch(function() { resolve(true); });
            } else if (Date.now() - start > ${MATHJAX_SETTLE_MS}) {
              resolve(true);
            } else {
              setTimeout(check, 200);
            }
          }
          check();
        })`,
        { timeout: PDF_TIMEOUT_MS }
      );
      const marginValue = MARGIN_VALUES[options?.margins ?? 'normal'] ?? '1cm';
      const pdf = await page.pdf({
        format: options?.paperSize ?? 'A4',
        landscape: options?.orientation === 'landscape',
        printBackground: true,
        margin: {
          top: marginValue,
          right: marginValue,
          bottom: marginValue,
          left: marginValue,
        },
        timeout: PDF_TIMEOUT_MS,
      });
      return Buffer.from(pdf);
    } catch (error) {
      if (error instanceof TimeoutError || isProtocolTimeout(error)) {
        throw new PdfRenderTimeoutError();
      }
      if (isBrowserGoneError(error)) {
        throw new PdfRenderCrashedError(error);
      }
      throw error;
    } finally {
      await browser.close().catch(() => {});
    }
  }
}
