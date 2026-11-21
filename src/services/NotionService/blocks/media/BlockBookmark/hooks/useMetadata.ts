import instrumentedAxios from '../../../../../observability/instrumentedAxios';
import {
  pickPreferredIcons,
  resolveIconThroughSharedClient,
  runIconLookup,
} from './resolveIconThroughSharedClient';
import { withDeadline } from './withDeadline';

export const PAGE_FETCH_DEADLINE_MS = 10_000;
export const PAGE_MAX_BYTES = 5 * 1024 * 1024;

// Every metascraper-* package exports a rule FACTORY — it must be called.
// Passing the factory itself makes metascraper treat the module's attached
// helper exports (createFavicon, pickBiggerSize, ...) as rule names and
// bookmark blocks silently lose their preview metadata (#4205).
const metascraper = require('metascraper')([
  require('metascraper-description')(),
  require('metascraper-image')(),
  require('metascraper-logo-favicon')({
    google: false,
    pickFn: pickPreferredIcons,
    resolveFaviconUrl: resolveIconThroughSharedClient,
  }),
  require('metascraper-title')(),
  require('metascraper-url')(),
]);

export interface Metadata {
  description: string;
  title: string;
  logo: string;
  image: string;
}

export default async function useMetadata(url: string): Promise<Metadata> {
  try {
    const response = await withDeadline(PAGE_FETCH_DEADLINE_MS, (signal) =>
      instrumentedAxios.get<string>('notion', url, {
        maxContentLength: PAGE_MAX_BYTES,
        signal,
      })
    );
    return await runIconLookup(() => metascraper({ html: response.data, url }));
  } catch (error) {
    console.error(error);
    return {
      description: '',
      title: new URL(url).hostname,
      logo: '',
      image: '',
    };
  }
}
