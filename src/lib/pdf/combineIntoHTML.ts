import path from 'path';

export function combineIntoHTML(
  imagePaths: string[],
  title: string,
  workspaceLocation?: string
): string {
  const toSrc = (imagePath: string) =>
    workspaceLocation
      ? path.relative(workspaceLocation, imagePath).replaceAll('\\', '/')
      : path.basename(imagePath);

  const html = `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
  ${Array.from({ length: Math.ceil(imagePaths.length / 2) }, (_, i) => {
    const front = toSrc(imagePaths[i * 2]);
    const backPath = imagePaths[i * 2 + 1];
    const back =
      backPath == null ? '' : `\n        <img src="${toSrc(backPath)}" />`;
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
