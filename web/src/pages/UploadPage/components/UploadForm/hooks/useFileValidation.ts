import { useCallback, useState } from 'react';
import { track } from '../../../../../lib/analytics/track';

export type ValidationStatus = 'clean' | 'info' | 'warning' | 'error';

export interface FileValidationResult {
  status: ValidationStatus;
  title: string;
  body: string;
  continueLabel: string;
  // Marks the two Safari-unzipped-Notion-export warnings so their rate is
  // measurable — they size the population the folder-drop path addresses.
  code?: 'unbundled_html';
}

export function detectUploadIssues(
  files: FileList | File[],
  aiOn = false
): FileValidationResult | null {
  const fileArray = Array.from(files);
  if (fileArray.length === 0) return null;

  const allMarkdown = fileArray.every((f) =>
    f.name.toLowerCase().endsWith('.md')
  );
  if (allMarkdown) {
    return {
      status: 'error',
      title: 'Markdown files produce simple cards',
      body: "Exported from Notion? Choose HTML in Notion's export menu — you'll keep images, toggles, and formatting. For a plain Markdown file, cards are built from bullet pairs.",
      continueLabel: 'Continue with this file',
    };
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

export function useFileValidation(aiOn = false) {
  const [validation, setValidation] = useState<FileValidationResult | null>(
    null
  );
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);

  const validate = useCallback(
    (files: FileList): boolean => {
      const result = detectUploadIssues(files, aiOn);
      if (result) {
        if (result.code === 'unbundled_html') {
          track('unbundled_html_warning_shown');
        }
        setValidation(result);
        setPendingFiles(files);
        return false;
      }
      setValidation(null);
      setPendingFiles(null);
      return true;
    },
    [aiOn]
  );

  const reset = useCallback(() => {
    setValidation(null);
    setPendingFiles(null);
  }, []);

  return { validation, pendingFiles, validate, reset };
}
