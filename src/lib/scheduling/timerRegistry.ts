/**
 * Every boot-time scheduler registers its interval handle here so graceful
 * shutdown can clear them all before the drain (#4206) — an uncleared timer
 * can fire mid-shutdown against a closing DB pool or hold the process open
 * into the 85s force-exit. Registration also unrefs uniformly: no scheduler
 * should keep the process alive on its own.
 */
const handles = new Set<NodeJS.Timeout>();

export function registerSchedulerTimer<
  T extends NodeJS.Timeout | undefined | null,
>(handle: T): T {
  if (handle != null) {
    handle.unref();
    handles.add(handle);
  }
  return handle;
}

export function clearSchedulerTimers(): number {
  const count = handles.size;
  for (const handle of handles) {
    clearInterval(handle);
  }
  handles.clear();
  return count;
}
