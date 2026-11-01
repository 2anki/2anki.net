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

  clear(): void {
    this.strikethroughs = [];
  }
}
