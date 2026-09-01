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
  code?: 'unbundled_html' | 'markdown' | 'markdown_zip';
}

const ZIP_PEEK_BUDGET_BYTES = 200 * 1024 * 1024;

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

export function detectUploadIssues(
  files: FileList | File[],
  aiOn = false,
  t?: ValidationTranslator
): FileValidationResult | null {
  const fileArray = Array.from(files);
  if (fileArray.length === 0) return null;

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
      title: 'Multiple HTML files — images may be missing',
      body: 'Safari sometimes unpacks Notion exports and leaves images behind. Re-download the zip from Notion in a different browser, or find the original zip in Downloads and upload that.',
      continueLabel: 'Continue with these files',
      code: 'unbundled_html',
    };
  }

  const allPdf = fileArray.every((f) => f.name.toLowerCase().endsWith('.pdf'));
  if (allPdf) {
    if (aiOn) return null;
    return {
      status: 'info',
      title: 'Each pair of pages becomes one card',
      body: 'Odd pages are card fronts, even pages are backs. Works well for lecture slides where each topic spans 2 pages. Change this in Card Options.',
      continueLabel: 'Make cards from this PDF',
    };
  }

  if (fileArray.length === 1 && htmlFiles.length === 1) {
    return {
      status: 'warning',
      title: 'Images won’t be included',
      body: "A single HTML file doesn't include images. If this came from Notion, download the zip export instead — it bundles the images.",
      continueLabel: 'Continue without images',
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
      title: 'Reading-format support',
      body: 'Kindle highlights from My Clippings.txt and DRM-free EPUBs are supported. To export your Kindle highlights, connect your Kindle by USB and copy the My Clippings.txt file from the device’s documents folder.',
      continueLabel: 'Make cards from these highlights',
    };
  }

  return null;
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

function trackValidationShown(result: FileValidationResult): void {
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
  }
}

export function useFileValidation(aiOn = false, t?: ValidationTranslator) {
  const [validation, setValidation] = useState<FileValidationResult | null>(
    null
  );
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);

  const validate = useCallback(
    async (files: FileList): Promise<boolean> => {
      const result =
        detectUploadIssues(files, aiOn, t) ??
        (await detectMarkdownZipIssue(files, t));
      if (result) {
        trackValidationShown(result);
        setValidation(result);
        setPendingFiles(files);
        return false;
      }
      setValidation(null);
      setPendingFiles(null);
      return true;
    },
    [aiOn, t]
  );

  const reset = useCallback(() => {
    setValidation(null);
    setPendingFiles(null);
  }, []);

  return { validation, pendingFiles, validate, reset };
}
