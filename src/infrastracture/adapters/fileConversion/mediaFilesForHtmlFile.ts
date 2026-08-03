import { isImageFile } from '../../../lib/storage/checks';

function mediaPrefixForHtml(htmlFileName: string): string {
  const normalized = htmlFileName.replaceAll('\\', '/');
  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash >= 0 ? normalized.substring(0, lastSlash) : '';
  const base = normalized
    .substring(lastSlash + 1)
    .replace(/\.html$/i, '')
    .replace(/ [a-f0-9]{32}$/i, '')
    .trim();
  return dir ? `${dir}/${base}/` : `${base}/`;
}

// Media matched by the Notion-export convention (<dir>/<html-base>/...) stays
// scoped to its page. Images that sit under NO html file's folder — sibling
// or root-level layouts from non-Notion zips — used to match nothing and
// silently vanish from AI conversions (#3946); they are now offered to every
// html file. Only images qualify for the fallback: the unclaimed pool also
// holds the original .docx/.pdf sources, which are not card media.
export function mediaFilesForHtmlFile(
  htmlFileName: string,
  allMediaFiles: string[],
  allHtmlFileNames: string[]
): string[] {
  const ownPrefix = mediaPrefixForHtml(htmlFileName);
  const allPrefixes = allHtmlFileNames.map(mediaPrefixForHtml);
  return allMediaFiles.filter((m) => {
    const normalized = m.replaceAll('\\', '/');
    if (normalized.startsWith(ownPrefix)) return true;
    return (
      isImageFile(normalized) &&
      !allPrefixes.some((prefix) => normalized.startsWith(prefix))
    );
  });
}
