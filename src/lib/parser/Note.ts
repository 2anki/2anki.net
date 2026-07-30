const REFRESH_ICON_PATTERN = /(?:&#x1F504;?|🔄)/g;

export function removeRefreshIcon(value: string): string {
  return value.replace(REFRESH_ICON_PATTERN, '').trim();
}

export default class Note {
  name: string;

  back: string;

  tags: string[];

  sectionTags: string[] = [];

  cloze = false;

  number = 0;

  enableInput = false;

  answer = '';

  media: string[] = [];

  notionId?: string;

  notionLink?: string;

  guid?: string;

  sourcePageId?: string;

  mcq = false;

  options: string[] = [];

  correctIndices: number[] = [];

  customFields?: string[];

  customFieldNames?: string[];

  customModelName?: string;

  hierarchy?: boolean;

  h1?: string;

  h2?: string;

  h3?: string;

  constructor(name: string, back: string) {
    this.name = name;
    this.back = back;
    this.tags = [];
  }

  hasCherry() {
    const cherry = '&#x1F352;';
    return (
      (this.name && (this.name.includes(cherry) || this.name.includes('🍒'))) ||
      (this.back && (this.back.includes(cherry) || this.back.includes('🍒')))
    );
  }

  hasAvocado() {
    const avocado = '&#x1F951';
    return (
      (this.name &&
        (this.name.includes(avocado) || this.name.includes('🥑'))) ||
      (this.back && (this.back.includes(avocado) || this.back.includes('🥑')))
    );
  }

  copyValues(clozeCard: Note) {
    this.name = clozeCard.name;
    this.back = clozeCard.back;
    this.tags = clozeCard.tags;
    this.cloze = clozeCard.cloze;
    this.number = clozeCard.number;
    this.enableInput = clozeCard.enableInput;
    this.answer = clozeCard.answer;
    this.media = clozeCard.media;
    this.notionId = clozeCard.notionId;
    this.notionLink = clozeCard.notionLink;
    this.mcq = clozeCard.mcq;
    this.options = clozeCard.options;
    this.correctIndices = clozeCard.correctIndices;
  }

  hasRefreshIcon() {
    return this.name.includes('&#x1F504') || this.name.includes('🔄');
  }

  stripRefreshIcon() {
    this.name = removeRefreshIcon(this.name);
    this.back = removeRefreshIcon(this.back);
  }

  reversed(input: Note): Note {
    const note = new Note(
      removeRefreshIcon(input.back),
      removeRefreshIcon(input.name)
    );
    note.tags = input.tags;
    note.media = input.media;
    note.number = input.number + 0.5;
    note.hierarchy = input.hierarchy;
    note.h1 = input.h1;
    note.h2 = input.h2;
    note.h3 = input.h3;
    if (input.notionId) {
      note.notionId = `${input.notionId}::rev`;
      note.sourcePageId = input.sourcePageId;
    }
    return note;
  }

  isValidMCQNote(): boolean {
    return (
      this.mcq &&
      this.name.trim().length > 0 &&
      this.options.length >= 2 &&
      this.correctIndices.length === 1
    );
  }

  isValidBasicNote(): boolean {
    if (!this.name || !this.back) {
      return false;
    }
    return this.name.trim().length > 0 && this.back.trim().length > 0;
  }

  isValidClozeNote() {
    return this.cloze && this.name && this.name.trim();
  }

  isValidInputNote() {
    return this.enableInput && this.name && this.answer && this.answer.trim();
  }

  hasClozeDeletion(): boolean {
    return this.name.includes('{{c') || this.back.includes('{{c');
  }

  isReversibleBasic(): boolean {
    return !this.mcq && !this.isValidInputNote() && !this.hasClozeDeletion();
  }
}
