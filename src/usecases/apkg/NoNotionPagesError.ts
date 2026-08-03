export default class NoNotionPagesError extends Error {
  constructor(
    message = 'No Notion pages available. Share at least one page with 2anki to use quick import.'
  ) {
    super(message);
    this.name = 'NoNotionPagesError';
  }
}
