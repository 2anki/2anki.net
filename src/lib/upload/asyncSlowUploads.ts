import { getFeatureFlag } from '../featureFlags/getFeatureFlag';

export const ASYNC_SLOW_UPLOADS_FLAG = 'async_slow_uploads';

// A request that has to stay open for a whole slow conversion is the one phones
// and Safari drop when the tab sleeps or the network changes. PowerPoint always
// goes through LibreOffice, so it is slow at any size; a PDF only becomes slow
// once it is large.
export const ASYNC_PDF_MIN_BYTES = 5 * 1024 * 1024;

const SLOW_PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx', 'odp']);

export interface SlowUploadCandidate {
  originalname: string;
  size: number;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

// A PDF the person has not yet answered "what should this become" for stays on
// the normal path, because only that path can ask the question back.
export function isSlowUpload(
  files: readonly SlowUploadCandidate[],
  pdfFallback: 'ask' | 'pairs' | 'single'
): boolean {
  if (files.length !== 1) {
    return false;
  }
  const [file] = files;
  const extension = extensionOf(file.originalname);
  if (SLOW_PRESENTATION_EXTENSIONS.has(extension)) {
    return true;
  }
  return (
    extension === 'pdf' &&
    pdfFallback !== 'ask' &&
    file.size >= ASYNC_PDF_MIN_BYTES
  );
}

export function asyncSlowUploadsEnabled(): Promise<boolean> {
  return getFeatureFlag(ASYNC_SLOW_UPLOADS_FLAG, false);
}
