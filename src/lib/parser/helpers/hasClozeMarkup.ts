const CLOZE_MARKUP_RE = /{{c\d+::[^}]+}}/;

export default function hasClozeMarkup(text: string | undefined): boolean {
  return text != null && CLOZE_MARKUP_RE.test(text);
}
