import { isHTMLFile, isMarkdownFile } from '../../storage/checks';

export interface PromptedFile {
  name: string;
  contents?: Buffer | string | null;
}

// The start-of-conversion pre-check estimates cost from what actually reaches
// Claude as a prompt — the text of HTML and Markdown files — never a binary
// upload's byte length. A large PDF or image carries almost no prompt text, so
// counting its raw bytes would refuse AI on file size alone. Vision-token cost
// for PDF/image paths is left to the per-call guard rather than estimated here.
export function estimatePromptedBytes(files: PromptedFile[]): number {
  return files.reduce((sum, file) => {
    if (file.contents == null) {
      return sum;
    }
    if (isHTMLFile(file.name) || isMarkdownFile(file.name)) {
      return sum + file.contents.length;
    }
    return sum;
  }, 0);
}
