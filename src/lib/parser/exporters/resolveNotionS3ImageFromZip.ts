import { File } from '../../zip/zip';

const NOTION_S3_HOST = 'prod-files-secure.s3';

export function resolveNotionS3ImageFromZip(
  url: string,
  files: File[]
): File | null {
  if (!url.startsWith('https://') || !url.includes(NOTION_S3_HOST)) {
    return null;
  }

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const encoded = pathname.split('/').pop();
  if (!encoded) return null;

  const filename = decodeURIComponent(encoded);

  const match = files.find((f) => {
    const normalizedName = f.name.replaceAll('\\', '/');
    return (
      normalizedName === filename || normalizedName.endsWith('/' + filename)
    );
  });

  return match ?? null;
}

export function isNotionSignedFileUrl(url: string): boolean {
  if (!url.startsWith('https://')) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const isNotionHost =
    parsed.hostname.includes(NOTION_S3_HOST) ||
    parsed.hostname === 'file.notion.so' ||
    (parsed.hostname.endsWith('.amazonaws.com') &&
      parsed.pathname.includes('secure.notion-static.com'));

  if (!isNotionHost) {
    return false;
  }

  return (
    parsed.searchParams.has('X-Amz-Signature') ||
    parsed.searchParams.has('expirationTimestamp')
  );
}
