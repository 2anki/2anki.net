import { useCallback, useState } from 'react';
import { unzip } from 'fflate';
import { track } from '../../../../../lib/analytics/track';

export type ValidationStatus = 'clean' | 'info' | 'warning' | 'error';

export type ValidationTranslator = (key: string) => string;

export interface FileValidationResult {
  status: ValidationStatus;
  title: string;
  body: string;
  continueLabel: string;
  // Marks the two Safari-unzipped-Notion-export warnings so their rate is
  // measurable — they size the population the folder-drop path addresses.
  // markdown / markdown_zip mark the Notion-Markdown guardrails so
  // overridden÷shown reads as the crying-wolf ratio.
  code?:
    | 'unbundled_html'
    | 'markdown'
    | 'markdown_zip'
    | 'shortcut'
    | 'internet_shortcut'
    | 'internet_shortcut_notion'
    | 'internet_shortcut_link'
    | 'goodnotes'
    | 'icon';
  // A file 2anki cannot read at all: the only way forward is another file, so
  // there is no convert-anyway button.
  blocking?: boolean;
  actionLink?: { label: string; href: string };
}

const ZIP_PEEK_BUDGET_BYTES = 200 * 1024 * 1024;
const INTERNET_SHORTCUT_READ_BUDGET_BYTES = 64 * 1024;
const NOTION_HOSTS = ['notion.so', 'notion.site'];
const WEB_PROTOCOLS = new Set(['http:', 'https:']);

function translate(t: ValidationTranslator | undefined, key: string): string {
  return t ? t(key) : key;
}

function markdownResult(t?: ValidationTranslator): FileValidationResult {
  return {
    status: 'warning',
    title: translate(t, 'upload.validation.markdown.title'),
    body: translate(t, 'upload.validation.markdown.body'),
    continueLabel: translate(t, 'upload.validation.continue'),
    code: 'markdown',
  };
}

function markdownZipResult(t?: ValidationTranslator): FileValidationResult {
  return {
    status: 'warning',
    title: translate(t, 'upload.validation.markdownZip.title'),
    body: translate(t, 'upload.validation.markdownZip.body'),
    continueLabel: translate(t, 'upload.validation.continue'),
    code: 'markdown_zip',
  };
}

const WRONG_FILE_RULES = [
  { extension: '.lnk', key: 'shortcut', code: 'shortcut' },
  { extension: '.url', key: 'internetShortcut', code: 'internet_shortcut' },
  { extension: '.goodnotes', key: 'goodnotes', code: 'goodnotes' },
  { extension: '.ico', key: 'icon', code: 'icon' },
] as const;

function wrongFileResult(
  files: File[],
  t?: ValidationTranslator
): FileValidationResult | null {
  for (const rule of WRONG_FILE_RULES) {
    if (files.every((f) => f.name.toLowerCase().endsWith(rule.extension))) {
      return {
        status: 'error',
        title: translate(t, `upload.validation.${rule.key}.title`),
        body: translate(t, `upload.validation.${rule.key}.body`),
        continueLabel: '',
        code: rule.code,
        blocking: true,
      };
    }
  }
  return null;
}

export function detectUploadIssues(
  files: FileList | File[],
  t?: ValidationTranslator
): FileValidationResult | null {
  const fileArray = Array.from(files);
  if (fileArray.length === 0) return null;

  const wrongFile = wrongFileResult(fileArray, t);
  if (wrongFile) return wrongFile;

  const allMarkdown = fileArray.every((f) =>
    f.name.toLowerCase().endsWith('.md')
  );
  if (allMarkdown) {
    return markdownResult(t);
  }

  const htmlFiles = fileArray.filter((f) =>
    f.name.toLowerCase().endsWith('.html')
  );

  if (htmlFiles.length >= 2) {
    return {
      status: 'warning',
      title: translate(t, 'upload.validation.unbundledMany.title'),
      body: translate(t, 'upload.validation.unbundledMany.body'),
      continueLabel: translate(t, 'upload.validation.unbundledMany.continue'),
      code: 'unbundled_html',
    };
  }

  const allPdf = fileArray.every((f) => f.name.toLowerCase().endsWith('.pdf'));
  if (allPdf) return null;

  if (fileArray.length === 1 && htmlFiles.length === 1) {
    return {
      status: 'warning',
      title: translate(t, 'upload.validation.unbundledSingle.title'),
      body: translate(t, 'upload.validation.unbundledSingle.body'),
      continueLabel: translate(t, 'upload.validation.unbundledSingle.continue'),
      code: 'unbundled_html',
    };
  }

  const isClippings = fileArray.some((f) =>
    /(^|[/\\])my clippings\.txt$/i.test(f.name)
  );
  const isEpub = fileArray.some((f) => f.name.toLowerCase().endsWith('.epub'));
  if (isClippings || isEpub) {
    return {
      status: 'info',
      title: translate(t, 'upload.validation.readingFormat.title'),
      body: translate(t, 'upload.validation.readingFormat.body'),
      continueLabel: translate(t, 'upload.validation.readingFormat.continue'),
    };
  }

  return null;
}

function isInternetShortcut(file: File): boolean {
  return file.name.toLowerCase().endsWith('.url');
}

function isNotionHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return NOTION_HOSTS.some(
    (notionHost) => host === notionHost || host.endsWith(`.${notionHost}`)
  );
}

async function readShortcutUrl(file: File): Promise<URL | null> {
  if (file.size > INTERNET_SHORTCUT_READ_BUDGET_BYTES) return null;
  let text: string;
  try {
    text = await file.text();
  } catch {
    return null;
  }
  const urlLine = text
    .split(/\r?\n/)
    .map((line) => /^\s*URL\s*=\s*(\S+)\s*$/i.exec(line))
    .find((match) => match != null);
  if (urlLine == null) return null;
  let url: URL;
  try {
    url = new URL(urlLine[1]);
  } catch {
    return null;
  }
  return WEB_PROTOCOLS.has(url.protocol) ? url : null;
}

export async function detectInternetShortcutIssue(
  files: FileList | File[],
  t?: ValidationTranslator
): Promise<FileValidationResult | null> {
  const fileArray = Array.from(files);
  if (fileArray.length === 0 || !fileArray.every(isInternetShortcut)) {
    return null;
  }

  const urls = (await Promise.all(fileArray.map(readShortcutUrl))).filter(
    (url): url is URL => url != null
  );
  if (urls.length === 0) return null;

  if (urls.some((url) => isNotionHost(url.hostname))) {
    return {
      status: 'error',
      title: translate(t, 'upload.validation.internetShortcutNotion.title'),
      body: translate(t, 'upload.validation.internetShortcutNotion.body'),
      continueLabel: '',
      code: 'internet_shortcut_notion',
      blocking: true,
      actionLink: {
        label: translate(t, 'upload.validation.internetShortcutNotion.action'),
        href: '/notion',
      },
    };
  }

  return {
    status: 'error',
    title: translate(t, 'upload.validation.internetShortcutLink.title'),
    body: translate(t, 'upload.validation.internetShortcutLink.body'),
    continueLabel: '',
    code: 'internet_shortcut_link',
    blocking: true,
  };
}

function listZipEntryNames(file: File): Promise<string[]> {
  return file.arrayBuffer().then(
    (buffer) =>
      new Promise<string[]>((resolve, reject) => {
        const names: string[] = [];
        unzip(
          new Uint8Array(buffer),
          {
            filter: (entry) => {
              names.push(entry.name);
              return false;
            },
          },
          (error) => {
            if (error != null) {
              reject(error);
              return;
            }
            resolve(names);
          }
        );
      })
  );
}

export async function detectMarkdownZipIssue(
  files: FileList | File[],
  t?: ValidationTranslator
): Promise<FileValidationResult | null> {
  const fileArray = Array.from(files);
  if (fileArray.length !== 1) return null;

  const file = fileArray[0];
  if (!file.name.toLowerCase().endsWith('.zip')) return null;
  if (file.size > ZIP_PEEK_BUDGET_BYTES) return null;

  let names: string[];
  try {
    names = await listZipEntryNames(file);
  } catch {
    return null;
  }

  const lowerNames = names.map((name) => name.toLowerCase());
  const hasMarkdown = lowerNames.some((name) => name.endsWith('.md'));
  const hasHtml = lowerNames.some((name) => name.endsWith('.html'));
  if (hasMarkdown && !hasHtml) {
    return markdownZipResult(t);
  }
  return null;
}

export async function detectFileIssues(
  files: FileList | File[],
  t?: ValidationTranslator
): Promise<FileValidationResult | null> {
  return (
    (await detectInternetShortcutIssue(files, t)) ??
    detectUploadIssues(files, t) ??
    (await detectMarkdownZipIssue(files, t))
  );
}

export function trackValidationShown(result: FileValidationResult): void {
  if (result.code === 'unbundled_html') {
    track('unbundled_html_warning_shown');
    return;
  }
  if (result.code === 'markdown') {
    track('upload_guardrail_shown', { kind: 'markdown' });
    return;
  }
  if (result.code === 'markdown_zip') {
    track('upload_guardrail_shown', { kind: 'markdown_zip' });
    return;
  }
  if (result.blocking && result.code != null) {
    track('upload_guardrail_shown', { kind: result.code });
  }
}

export function useFileValidation(t?: ValidationTranslator) {
  const [validation, setValidation] = useState<FileValidationResult | null>(
    null
  );
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);

  const validate = useCallback(
    async (files: FileList): Promise<boolean> => {
      const result = await detectFileIssues(files, t);
      if (result) {
        setValidation(result);
        setPendingFiles(files);
        return false;
      }
      setValidation(null);
      setPendingFiles(null);
      return true;
    },
    [t]
  );

  const reset = useCallback(() => {
    setValidation(null);
    setPendingFiles(null);
  }, []);

  return { validation, pendingFiles, validate, reset };
}
