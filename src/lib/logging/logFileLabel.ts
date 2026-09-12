import { createHash } from 'node:crypto';

// Upload file names are deck titles in disguise (Notion exports name the HTML
// after the page, PDFs after the course). Logs keep a correlation key and the
// extension, never the name (#4410).
export function logFileLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  const slash = name.lastIndexOf('/');
  const extension = dot > slash ? name.slice(dot + 1).toLowerCase() : 'none';
  const digest = createHash('sha1').update(name).digest('hex').slice(0, 8);
  return `${extension}:${digest}`;
}

export interface FileListSummary {
  count: number;
  extensions: Record<string, number>;
  sample: string[];
}

const SAMPLE_SIZE = 5;

export function summarizeFileNames(names: readonly string[]): FileListSummary {
  const extensions: Record<string, number> = {};
  for (const name of names) {
    const extension = logFileLabel(name).split(':')[0];
    extensions[extension] = (extensions[extension] ?? 0) + 1;
  }
  return {
    count: names.length,
    extensions,
    sample: names.slice(0, SAMPLE_SIZE).map(logFileLabel),
  };
}
