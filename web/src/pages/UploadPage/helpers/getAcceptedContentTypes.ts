export const ACCEPTED_FORMATS = [
  '.zip',
  '.html',
  '.md',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.csv',
  '.epub',
  '.opml',
  '.txt',
] as const;

const PICKER_ONLY_EXTENSIONS = [
  '.tsv',
  '.doc',
  '.ppt',
  '.xml',
  '.brainstorms.json',
] as const;

export const ACCEPTED_EXTENSIONS: string[] = [
  ...ACCEPTED_FORMATS,
  ...PICKER_ONLY_EXTENSIONS,
];

export default function getAcceptedContentTypes(): string {
  return ACCEPTED_EXTENSIONS.join(',');
}

export function formatAcceptedFormats(language?: string): string {
  return new Intl.ListFormat(language, {
    style: 'long',
    type: 'disjunction',
  }).format([...ACCEPTED_FORMATS]);
}
