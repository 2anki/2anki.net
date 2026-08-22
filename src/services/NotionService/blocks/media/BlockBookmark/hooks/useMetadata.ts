import instrumentedAxios from '../../../../../observability/instrumentedAxios';

// Every metascraper-* package exports a rule FACTORY — it must be called.
// Passing the factory itself makes metascraper treat the module's attached
// helper exports (createFavicon, pickBiggerSize, ...) as rule names and
// bookmark blocks silently lose their preview metadata (#4205).
const metascraper = require('metascraper')([
  require('metascraper-description')(),
  require('metascraper-image')(),
  require('metascraper-logo-favicon')(),
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
    const response = await instrumentedAxios.get('notion', url);
    return metascraper({ html: response.data, url });
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
