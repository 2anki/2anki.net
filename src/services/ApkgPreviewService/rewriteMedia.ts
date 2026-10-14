const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'ogg',
  'oga',
  'wav',
  'flac',
  'm4a',
  'aac',
  'opus',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov']);

const SOUND_TOKEN_REGEX = /\[sound:([^\]]+)\]/g;
const SRC_ATTR_REGEX = /\b(src|poster)="([^"]+)"/g;

function isLocalRef(value: string): boolean {
  return (
    !/^https?:\/\//i.test(value) &&
    !value.startsWith('data:') &&
    !value.startsWith('/')
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function encodeMediaUrl(baseUrl: string, name: string): string {
  return `${baseUrl}${encodeURIComponent(name)}`;
}

function decodeMediaRef(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function mediaUrlIfKnown(
  name: string,
  mediaMap: Map<string, string>,
  baseUrl: string
): string | null {
  if (!mediaMap.has(name)) return null;
  return encodeMediaUrl(baseUrl, name);
}

function renderSoundToken(
  name: string,
  mediaMap: Map<string, string>,
  baseUrl: string
): string {
  const url = mediaUrlIfKnown(name, mediaMap, baseUrl);
  if (!url) {
    return `<span class="apkg-missing-media">[missing: ${escapeHtml(name)}]</span>`;
  }
  const ext = extensionOf(name);
  if (VIDEO_EXTENSIONS.has(ext)) {
    return `<video controls preload="none" src="${url}"></video>`;
  }
  if (AUDIO_EXTENSIONS.has(ext) || ext === '') {
    return `<audio controls preload="none" src="${url}"></audio>`;
  }
  return `<a href="${url}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>`;
}

export function rewriteMediaRefs(
  html: string,
  mediaMap: Map<string, string>,
  baseUrl: string
): string {
  let out = html.replace(
    SRC_ATTR_REGEX,
    (_match, attr: string, value: string) => {
      if (!isLocalRef(value)) return `${attr}="${value}"`;
      const decoded = decodeMediaRef(value);
      const url = mediaUrlIfKnown(decoded, mediaMap, baseUrl);
      if (!url) return `${attr}="" data-missing-media="${escapeHtml(decoded)}"`;
      return `${attr}="${url}"`;
    }
  );
  out = out.replace(SOUND_TOKEN_REGEX, (_match, name: string) =>
    renderSoundToken(name.trim(), mediaMap, baseUrl)
  );
  return out;
}
