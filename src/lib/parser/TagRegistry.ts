import sanitizeTags from '../anki/sanitizeTags';

export default class TagRegistry {
  strikethroughs: string[];

  private readonly isCollecting: () => boolean;

  constructor(isCollecting: () => boolean = () => true) {
    this.strikethroughs = [];
    this.isCollecting = isCollecting;
  }

  collects(): boolean {
    return this.isCollecting();
  }

  addStrikethrough(strikethrough: string): boolean {
    if (!this.collects()) {
      return false;
    }
    this.strikethroughs.push(strikethrough);
    return true;
  }

  // The rule DeckParser.locateTags applies on uploads (split on commas, trim,
  // join words with a dash), minus the empty tags a trailing comma leaves.
  tags(): string[] {
    return sanitizeTags(
      this.strikethroughs.flatMap((s) => s.split(','))
    ).filter((tag) => tag !== '');
  }

  clear(): void {
    this.strikethroughs = [];
  }
}
