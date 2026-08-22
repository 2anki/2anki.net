import { NotionResource } from '../interfaces/NotionResource';

export function getResourceUrl(p: NotionResource) {
  if ('url' in p) {
    return p.url;
  }
  return undefined;
}
