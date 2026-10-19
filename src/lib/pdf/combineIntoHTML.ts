import path from 'path';

export function combineIntoHTML(
  imagePaths: string[],
  title: string,
  workspaceLocation?: string,
  pairPages = true
): string {
  const toSrc = (imagePath: string) =>
    workspaceLocation
      ? path.relative(workspaceLocation, imagePath).replaceAll('\\', '/')
      : path.basename(imagePath);

  const renderCard = (frontPath: string, backPath: string | undefined) => {
    const back =
      backPath == null ? '' : `\n        <img src="${toSrc(backPath)}" />`;
    return `<ul class="toggle">
    <li>
      <details>
        <summary>
        <img src="${toSrc(frontPath)}" />
        </summary>${back}
      </details>
    </li>
    </ul>`;
  };

  const cards = pairPages
    ? Array.from({ length: Math.ceil(imagePaths.length / 2) }, (_, i) =>
        renderCard(imagePaths[i * 2], imagePaths[i * 2 + 1])
      )
    : imagePaths.map((imagePath) => renderCard(imagePath, undefined));

  const html = `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
  ${cards.join('\n')}
</body>
</html>`;

  return html;
}
