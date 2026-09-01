import { createHash } from 'node:crypto';

export interface ConversionCacheKeyInput {
  content: string;
  mediaFiles: string[];
  userInstructions?: string;
  cardStyle?: string;
  cardSize?: string;
  fieldMapping?: unknown;
  comprehensive?: boolean;
  isPaying?: boolean;
  model: string;
  promptVersion: string;
}

export interface ConversionResultCacheSave<T> {
  key: string;
  result: T;
  model: string;
  promptVersion: string;
}

export interface ConversionResultCacheStore<T> {
  get(key: string): Promise<T | undefined>;
  save(entry: ConversionResultCacheSave<T>): Promise<void>;
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

export function buildConversionCacheKey(
  input: ConversionCacheKeyInput
): string {
  const canonical = JSON.stringify({
    v: 1,
    content: normalizeContent(input.content),
    mediaFiles: input.mediaFiles,
    userInstructions: input.userInstructions ?? '',
    cardStyle: input.cardStyle ?? '',
    cardSize: input.cardSize ?? '',
    fieldMapping: input.fieldMapping ?? null,
    comprehensive: input.comprehensive === true,
    isPaying: input.isPaying === true,
    model: input.model,
    promptVersion: input.promptVersion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

async function readConversionCache<T>(
  store: ConversionResultCacheStore<T>,
  key: string
): Promise<T | undefined> {
  try {
    return await store.get(key);
  } catch (error) {
    console.warn('[Claude] conversion cache read failed; converting fresh', {
      key: key.slice(0, 12),
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function writeConversionCache<T>(
  store: ConversionResultCacheStore<T>,
  entry: ConversionResultCacheSave<T>
): Promise<void> {
  try {
    await store.save(entry);
  } catch (error) {
    console.warn('[Claude] conversion cache write failed', {
      key: entry.key.slice(0, 12),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function withConversionResultCache<T>(
  store: ConversionResultCacheStore<T> | undefined,
  keyInput: ConversionCacheKeyInput,
  compute: () => Promise<T>
): Promise<T> {
  if (store == null) return compute();

  const key = buildConversionCacheKey(keyInput);
  const cached = await readConversionCache(store, key);
  if (cached != null) {
    console.log('[Claude] conversion cache hit', {
      key: key.slice(0, 12),
      model: keyInput.model,
    });
    return cached;
  }

  const result = await compute();
  await writeConversionCache(store, {
    key,
    result,
    model: keyInput.model,
    promptVersion: keyInput.promptVersion,
  });
  return result;
}
