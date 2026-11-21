import instrumentedAxios from '../../../../../observability/instrumentedAxios';

const ICON_PROBE_TIMEOUT_MS = 5000;
const ICON_PROBE_MAX_BYTES = 1024 * 1024;
const ASCII_LESS_THAN = 60;

export interface ReachableIcon {
  url: string;
}

const declaredContentType = (headers: unknown): string | undefined => {
  if (headers == null || typeof headers !== 'object') return undefined;
  const raw = (headers as Record<string, unknown>)['content-type'];
  if (typeof raw !== 'string') return undefined;
  return raw.split(';')[0].trim().toLowerCase();
};

const firstByte = (data: unknown): number | undefined => {
  if (Buffer.isBuffer(data)) return data[0];
  if (data instanceof ArrayBuffer) return new Uint8Array(data)[0];
  return undefined;
};

const matchesExpectedType = (
  contentType: string | undefined,
  expected: readonly unknown[]
): boolean =>
  contentType != null &&
  expected.flat().some((type) => contentType.includes(String(type)));

const isServiceRefusal = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith('[observability]');

export async function resolveIconThroughSharedClient(
  iconUrl: string,
  expectedContentTypes?: readonly unknown[]
): Promise<ReachableIcon | undefined> {
  let response;
  try {
    response = await instrumentedAxios.get<ArrayBuffer>('notion', iconUrl, {
      responseType: 'arraybuffer',
      headers: { Range: 'bytes=0-0' },
      timeout: ICON_PROBE_TIMEOUT_MS,
      maxContentLength: ICON_PROBE_MAX_BYTES,
    });
  } catch (error) {
    if (isServiceRefusal(error)) {
      console.warn('[bookmark-icon] shared client refused an icon URL');
    }
    return undefined;
  }

  if (expectedContentTypes == null) return { url: iconUrl };

  if (
    !matchesExpectedType(
      declaredContentType(response.headers),
      expectedContentTypes
    )
  ) {
    return undefined;
  }

  const leadingByte = firstByte(response.data);
  if (leadingByte == null || leadingByte === ASCII_LESS_THAN) return undefined;

  return { url: iconUrl };
}
