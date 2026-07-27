import { get2ankiApi } from './get2ankiApi';

export async function startUnlimitedUpgrade(surface: string): Promise<void> {
  const result = await get2ankiApi().startUnlimitedCheckout(
    'month',
    undefined,
    surface
  );
  globalThis.location.href =
    'url' in result
      ? result.url
      : `/pricing?source=${encodeURIComponent(surface)}`;
}
