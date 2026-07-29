import fs from 'node:fs';
import path from 'node:path';

export const CONVERSION_FALLBACK_FILENAME = 'conversion-fallback.json';

export function writePdfImageFallbackMarker(
  workspaceDir: string,
  fallbackNames: string[]
): void {
  if (fallbackNames.length === 0) {
    return;
  }
  try {
    fs.writeFileSync(
      path.join(workspaceDir, CONVERSION_FALLBACK_FILENAME),
      JSON.stringify(fallbackNames)
    );
  } catch (error) {
    console.warn('[pdfImageFallbackMarker] failed to persist fallback marker', {
      workspaceDir,
      error,
    });
  }
}

export function loadPdfImageFallbackNames(workspaceDir: string): Set<string> {
  const markerPath = path.join(workspaceDir, CONVERSION_FALLBACK_FILENAME);
  try {
    if (!fs.existsSync(markerPath)) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(
      parsed.filter((name): name is string => typeof name === 'string')
    );
  } catch (error) {
    console.warn(
      '[pdfImageFallbackMarker] ignoring unreadable fallback marker',
      {
        workspaceDir,
        error,
      }
    );
    return new Set();
  }
}

export function matchesPdfImageFallback(
  htmlFilePath: string,
  workspaceDir: string,
  fallbackNames: Set<string>
): boolean {
  if (fallbackNames.size === 0) {
    return false;
  }
  const relative = path
    .relative(workspaceDir, htmlFilePath)
    .replaceAll('\\', '/');
  const base = path.basename(htmlFilePath);
  for (const marker of fallbackNames) {
    const normalized = marker.replaceAll('\\', '/');
    if (normalized === relative || normalized === base) {
      return true;
    }
    if (normalized.split('/').pop() === base) {
      return true;
    }
  }
  return false;
}
