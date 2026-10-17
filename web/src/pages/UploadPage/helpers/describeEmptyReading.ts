import type { TFunction } from 'i18next';

import type { EmptyUploadReading } from '../../../lib/upload/isEmptyUploadReading';

export type EmptyReadingNextStep =
  | 'readingNext'
  | 'readingNextAnswers'
  | 'readingNextToggles';

export interface EmptyReadingCopy {
  text: string;
  next: EmptyReadingNextStep | null;
}

// VOICE.md: a thin space groups thousands from 10 000 up, never a comma.
export function formatCount(count: number): string {
  if (count < 10_000) return String(count);
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
}

function joinParts(parts: string[], language: string): string {
  if (typeof Intl.ListFormat !== 'function') {
    return parts.join(', ');
  }
  return new Intl.ListFormat(language, {
    style: 'long',
    type: 'conjunction',
  }).format(parts);
}

function countedParts(
  t: TFunction,
  counts: [key: string, count: number][]
): string[] {
  return counts
    .filter(([, count]) => count > 0)
    .map(([key, count]) =>
      t(`upload.form.${key}`, { count, n: formatCount(count) })
    );
}

// One or two sentences saying what the parser saw in the file, plus which
// next step fits, so "no cards" stops being a verdict and becomes a reading
// the user can act on. A reading that ends on its own instruction (no text,
// an empty zip, a zip with nothing readable) carries no next step. A document
// that already has headings was tried by the heading rule and failed it, so
// its next step points at toggles only.
export function describeEmptyReading(
  reading: EmptyUploadReading,
  t: TFunction,
  language: string
): EmptyReadingCopy {
  if (reading.kind === 'zip') {
    if (reading.files === 0) {
      return { text: t('upload.form.readingZipEmpty'), next: null };
    }
    const parts = countedParts(t, [
      ['readingPages', reading.readable],
      ['readingArchives', reading.archives],
      ['readingImageFiles', reading.imageFiles],
      ['readingOtherFiles', reading.otherFiles],
    ]);
    const lead = t('upload.form.readingZipLead', {
      parts: joinParts(parts, language),
    });
    if (reading.readable === 0 && reading.archives === 0) {
      return {
        text: `${lead} ${t('upload.form.readingZipNoPages')}`,
        next: null,
      };
    }
    return {
      text: `${lead} ${t('upload.form.readingNoCards')}`,
      next: 'readingNext',
    };
  }
  if (reading.words === 0) {
    return { text: t('upload.form.readingNoText'), next: null };
  }
  const parts = countedParts(t, [
    ['readingWords', reading.words],
    ['readingHeadings', reading.headings],
    ['readingListItems', reading.listItems],
    ['readingTables', reading.tables],
    ['readingImages', reading.images],
    ['readingToggles', reading.toggles],
  ]);
  const lead = t('upload.form.readingLead', {
    parts: joinParts(parts, language),
  });
  if (reading.toggles > 0) {
    return {
      text: `${lead} ${t('upload.form.readingTogglesNoPairs')}`,
      next: 'readingNextAnswers',
    };
  }
  return {
    text: `${lead} ${t('upload.form.readingNoCards')}`,
    next: reading.headings > 0 ? 'readingNextToggles' : 'readingNext',
  };
}
