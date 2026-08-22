import type { ObjectIcon } from '../notion/getObjectIcon';

/**
 * The slice of a Notion page/database API object the web app actually reads.
 * Replaces the generated client's NotionPage/NotionDatabase, which kept 5.7K
 * lines of dead swagger output alive for these fields alone.
 */
export interface NotionResource {
  object: 'page' | 'database';
  id: string;
  url?: string;
  parent?: { type?: string };
  icon?: ObjectIcon['icon'];
}
