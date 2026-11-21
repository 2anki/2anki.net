import { AsyncLocalStorage } from 'node:async_hooks';

import instrumentedAxios from '../../../../../observability/instrumentedAxios';
import { withDeadline } from './withDeadline';

export const ICON_PROBE_DEADLINE_MS = 5000;
export const ICON_PROBE_MAX_BYTES = 64 * 1024;
export const ICON_LOOKUP_DEADLINE_MS = 10_000;
export const MAX_ICON_CANDIDATES = 10;
export const MAX_ICON_PROBES = MAX_ICON_CANDIDATES + 2;
const ASCII_LESS_THAN = 60;

export interface ReachableIcon {
  url: string;
}

interface IconLookup {
  signal: AbortSignal;
  probesLeft: number;
  refusals: number;
}

interface IconCandidate {
  url: string;
  size: { square: boolean; priority: number };
}

interface PickOptions {
  pickBiggerSize: PickBiggerSize;
}

type PickBiggerSize = ((
  candidates: IconCandidate[],
  options: PickOptions
) => Promise<string | undefined>) & {
  sortBySize: (candidates: IconCandidate[]) => IconCandidate[];
};

const iconLookups = new AsyncLocalStorage<IconLookup>();

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

const logRefusals = (count: number) => {
  console.warn(
    `[bookmark-icon] shared client refused ${count} icon URL${count === 1 ? '' : 's'}`
  );
};

const takeProbe = (lookup: IconLookup | undefined): boolean => {
  if (lookup == null) return true;
  if (lookup.signal.aborted || lookup.probesLeft <= 0) return false;
  lookup.probesLeft -= 1;
  return true;
};

const recordRefusal = (lookup: IconLookup | undefined) => {
  if (lookup == null) {
    logRefusals(1);
  } else {
    lookup.refusals += 1;
  }
};

export async function runIconLookup<T>(task: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ICON_LOOKUP_DEADLINE_MS);
  const lookup: IconLookup = {
    signal: controller.signal,
    probesLeft: MAX_ICON_PROBES,
    refusals: 0,
  };
  try {
    return await iconLookups.run(lookup, task);
  } finally {
    clearTimeout(timer);
    if (lookup.refusals > 0) logRefusals(lookup.refusals);
  }
}

export const pickPreferredIcons = (
  candidates: IconCandidate[],
  options: PickOptions
): Promise<string | undefined> => {
  const { pickBiggerSize } = options;
  const preferred = [
    ...pickBiggerSize.sortBySize(candidates.filter((c) => c.size.square)),
    ...pickBiggerSize.sortBySize(candidates.filter((c) => !c.size.square)),
  ].slice(0, MAX_ICON_CANDIDATES);
  return pickBiggerSize(preferred, options);
};

export async function resolveIconThroughSharedClient(
  iconUrl: string,
  expectedContentTypes?: readonly unknown[]
): Promise<ReachableIcon | undefined> {
  const lookup = iconLookups.getStore();
  if (!takeProbe(lookup)) return undefined;

  let response;
  try {
    response = await withDeadline(
      ICON_PROBE_DEADLINE_MS,
      (signal) =>
        instrumentedAxios.get<ArrayBuffer>('notion', iconUrl, {
          responseType: 'arraybuffer',
          headers: { Range: 'bytes=0-0' },
          maxContentLength: ICON_PROBE_MAX_BYTES,
          signal,
        }),
      lookup?.signal
    );
  } catch (error) {
    if (isServiceRefusal(error)) recordRefusal(lookup);
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
