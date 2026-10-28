import { escapeHtml } from '../notion-render/escape';
import { toSrc } from './pageImageSrc';

export type PageImageCardMode = 'pairs' | 'single';

export function combineIntoHTML(
  imagePaths: string[],
  title: string,
  workspaceLocation?: string,
  mode: PageImageCardMode = 'pairs'
): string {
  const src = (imagePath: string) => toSrc(imagePath, workspaceLocation);
  const safeTitle = escapeHtml(title);

  if (mode === 'single') {
    return singlePageHTML(imagePaths.map(src), safeTitle);
  }

  const html = `<!DOCTYPE html>
<html>
<head><title>${safeTitle}</title></head>
<body>
  ${Array.from({ length: Math.ceil(imagePaths.length / 2) }, (_, i) => {
    const front = src(imagePaths[i * 2]);
    const backPath = imagePaths[i * 2 + 1];
    const back =
      backPath == null ? '' : `\n        <img src="${src(backPath)}" />`;
    return `<ul class="toggle">
    <li>
      <details>
        <summary>
        <img src="${front}" />
        </summary>${back}
      </details>
    </li>
    </ul>`;
  }).join('\n')}
</body>
</html>`;

  return html;
}

// One card per page: the page is the front, and the back only names the page,
// so there is somewhere to add the answer in Anki.
function singlePageHTML(sources: string[], title: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
  ${sources
    .map(
      (src, i) => `<ul class="toggle">
    <li>
      <details>
        <summary>
        <img src="${src}" />
        </summary>
        <p>Page ${i + 1} of ${sources.length}</p>
      </details>
    </li>
    </ul>`
    )
    .join('\n')}
</body>
</html>`;
}
