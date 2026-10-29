const SENTENCE_END = /[.!?。！？]$/;

function usesFullWidthStops(language: string): boolean {
  return language === 'ja' || language.startsWith('ja-');
}

// Japanese closes a sentence with 。 and starts the next with no space.
export function joinLiveSentences(
  status: string,
  line: string,
  language: string
): string {
  if (status === '') return line;
  if (usesFullWidthStops(language)) {
    return SENTENCE_END.test(status)
      ? `${status}${line}`
      : `${status}。${line}`;
  }
  return SENTENCE_END.test(status) ? `${status} ${line}` : `${status}. ${line}`;
}
