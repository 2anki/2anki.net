import { KnownEvent } from './events';
import { track } from './track';

const shownThisLoad = new Set<string>();

export function forgetNoticesShownThisLoad(): void {
  shownThisLoad.clear();
}

export function trackNoticeOncePerLoad(
  name: KnownEvent,
  noticeKey: string | undefined,
  props: Record<string, unknown>
): void {
  if (noticeKey != null) {
    const seenKey = `${name}:${noticeKey}`;
    if (shownThisLoad.has(seenKey)) return;
    shownThisLoad.add(seenKey);
  }
  track(name, props);
}
