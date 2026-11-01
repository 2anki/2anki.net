export default class TagRegistry {
  strikethroughs: string[];

  private readonly collecting: boolean;

  constructor(collecting = true) {
    this.strikethroughs = [];
    this.collecting = collecting;
  }

  addStrikethrough(strikethrough: string): boolean {
    if (!this.collecting) {
      return false;
    }
    this.strikethroughs.push(strikethrough);
    return true;
  }

  clear(): void {
    this.strikethroughs = [];
  }
}
