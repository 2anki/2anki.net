import { convert } from 'html-to-text';

const TEXT_ONLY_BACK_OPTIONS = {
  selectors: [{ selector: 'a', options: { ignoreHref: true } }],
};

export default function convertTextOnlyBack(markup: string): string {
  return convert(markup, TEXT_ONLY_BACK_OPTIONS);
}
