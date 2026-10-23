// The account has no Notion connection it can use: never connected,
// disconnected, or a token Notion already rejected. The message stays
// 'unauthorized' for the callers that still match on it.
export class NotionNotConnectedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'NotionNotConnectedError';
  }
}
