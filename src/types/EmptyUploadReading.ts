// What the parser saw in an upload that produced no cards. Counts only, never
// filenames or text: the shape is shown back to the user so they know what to
// change, and it rides the 400 body, so it must carry nothing identifying.
export interface DocumentReading {
  kind: 'document';
  words: number;
  headings: number;
  listItems: number;
  tables: number;
  toggles: number;
  images: number;
}

export interface ZipReading {
  kind: 'zip';
  files: number;
  readable: number;
  archives: number;
  imageFiles: number;
  otherFiles: number;
}

export type EmptyUploadReading = DocumentReading | ZipReading;
