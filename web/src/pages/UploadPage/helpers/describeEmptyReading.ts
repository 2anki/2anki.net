import type { TFunction } from 'i18next';

import type { EmptyUploadReading } from '../../../lib/upload/isEmptyUploadReading';

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
    .map(([key, count]) => t(`upload.form.${key}`, { count }));
}

// One or two sentences saying what the parser saw in the file, so "no cards"
// stops being a verdict and becomes a reading the user can act on.
export function describeEmptyReading(
  reading: EmptyUploadReading,
  t: TFunction,
  language: string
): string {
  if (reading.kind === 'zip') {
    if (reading.files === 0) {
      return t('upload.form.readingZipEmpty');
    }
    const parts = countedParts(t, [
      ['readingPages', reading.readable],
      ['readingImageFiles', reading.imageFiles],
      ['readingOtherFiles', reading.otherFiles],
    ]);
    const lead = t('upload.form.readingZipLead', {
      parts: joinParts(parts, language),
    });
    const verdict =
      reading.readable === 0
        ? t('upload.form.readingZipNoPages')
        : t('upload.form.readingNoCards');
    return `${lead} ${verdict}`;
  }
  if (reading.words === 0) {
    return t('upload.form.readingNoText');
  }
  const parts = countedParts(t, [
    ['readingWords', reading.words],
    ['readingHeadings', reading.headings],
    ['readingListItems', reading.listItems],
    ['readingTables', reading.tables],
    ['readingImages', reading.images],
  ]);
  const lead = t('upload.form.readingLead', {
    parts: joinParts(parts, language),
  });
  const verdict =
    reading.toggles > 0
      ? t('upload.form.readingEmptyToggles', { count: reading.toggles })
      : t('upload.form.readingNoCards');
  return `${lead} ${verdict}`;
}
