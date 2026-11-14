import { track } from './analytics/track';
import { hasSessionHint } from './sessionHint';

const REPORT_THRESHOLD = 0.1;
const WINDOW_GAP_MS = 1000;
const WINDOW_MAX_MS = 5000;
const MAX_REPORTS_PER_PAGE = 3;
const TARGET_MAX_LENGTH = 60;
const PATH_MAX_SEGMENTS = 4;
const ROUTE_WORD = /^[a-z][a-z-]{0,23}$/;

export interface ShiftSample {
  value: number;
  startTime: number;
  path: string;
  target: string;
}

export interface LayoutShiftSummary {
  value: number;
  worst_value: number;
  worst_ms: number;
  worst_path: string;
  worst_target: string;
  shifts: number;
}

interface ShiftWindow {
  value: number;
  firstStart: number;
  lastStart: number;
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Routes carry ids and one-time tokens (/mindmaps/:id, /users/r/:token), and a
 * mistyped address can carry anything. Only a segment that reads as a route
 * word (lowercase letters and hyphens, under 24 characters) is kept, so none
 * of that reaches the events table.
 */
export function shiftPath(pathname: string): string {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  const safe = segments
    .slice(0, PATH_MAX_SEGMENTS)
    .map((segment) => (ROUTE_WORD.test(segment) ? segment : ':id'));
  return `/${safe.join('/')}`;
}

/**
 * Names the element by tag and its first class. A CSS module class
 * (Footer-module__footer___I47BE) is cut to file and local name so the value
 * is the same across builds.
 */
export function shiftTarget(node: Node | null | undefined): string {
  const element = node instanceof Element ? node : node?.parentElement;
  if (element == null) {
    return 'removed';
  }
  const tag = element.tagName.toLowerCase();
  const firstClass = element.classList.item(0);
  if (firstClass == null) {
    return tag;
  }
  const moduleClass = /^(.+?)-module__(.+?)___/.exec(firstClass);
  const name =
    moduleClass == null ? firstClass : `${moduleClass[1]}.${moduleClass[2]}`;
  return `${tag}.${name}`.slice(0, TARGET_MAX_LENGTH);
}

/**
 * Scores shifts the way the Core Web Vitals figure does: the largest burst,
 * where a burst is shifts under a second apart spanning at most five seconds.
 */
export class LayoutShiftTally {
  private current: ShiftWindow | null = null;
  private largest = 0;
  private worst: ShiftSample | null = null;
  private count = 0;

  add(sample: ShiftSample): void {
    this.count += 1;
    const open = this.current;
    const continues =
      open != null &&
      sample.startTime - open.lastStart < WINDOW_GAP_MS &&
      sample.startTime - open.firstStart < WINDOW_MAX_MS;
    this.current = continues
      ? {
          value: open.value + sample.value,
          firstStart: open.firstStart,
          lastStart: sample.startTime,
        }
      : {
          value: sample.value,
          firstStart: sample.startTime,
          lastStart: sample.startTime,
        };
    this.largest = Math.max(this.largest, this.current.value);
    if (this.worst == null || sample.value > this.worst.value) {
      this.worst = sample;
    }
  }

  summary(): LayoutShiftSummary | null {
    if (this.worst == null) {
      return null;
    }
    return {
      value: roundTo3(this.largest),
      worst_value: roundTo3(this.worst.value),
      worst_ms: Math.round(this.worst.startTime),
      worst_path: this.worst.path,
      worst_target: this.worst.target,
      shifts: this.count,
    };
  }
}

/**
 * Decides when a page's tally is worth sending: only once it is past 0.1,
 * where "needs improvement" starts, again only if it grew, and a few times at
 * most.
 */
export class LayoutShiftReporter {
  private sent = 0;
  private lastSentValue = 0;

  constructor(
    private readonly tally: LayoutShiftTally,
    private readonly send: (summary: LayoutShiftSummary) => void
  ) {}

  flush(): void {
    const summary = this.tally.summary();
    if (summary == null || summary.value <= REPORT_THRESHOLD) {
      return;
    }
    if (
      this.sent >= MAX_REPORTS_PER_PAGE ||
      summary.value <= this.lastSentValue
    ) {
      return;
    }
    this.sent += 1;
    this.lastSentValue = summary.value;
    this.send(summary);
  }
}

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
  sources?: { node: Node | null }[];
}

// randomUUID is missing outside secure contexts and in Chromium before 92,
// both of which still have layout shift entries.
function canReport(): boolean {
  return (
    typeof PerformanceObserver !== 'undefined' &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes('layout-shift') &&
    typeof globalThis.crypto?.randomUUID === 'function'
  );
}

export function startLayoutShiftReport(): void {
  if (!canReport()) {
    return;
  }
  const pageId = crypto.randomUUID();
  const tally = new LayoutShiftTally();
  const reporter = new LayoutShiftReporter(tally, (summary) => {
    track('layout_shift_reported', {
      ...summary,
      page_id: pageId,
      viewport_width: globalThis.innerWidth,
      viewport_height: globalThis.innerHeight,
      signed_in: hasSessionHint(),
    });
  });

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LayoutShiftEntry[]) {
      if (entry.hadRecentInput) continue;
      tally.add({
        value: entry.value,
        startTime: entry.startTime,
        path: shiftPath(globalThis.location.pathname),
        target: shiftTarget(entry.sources?.[0]?.node),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      reporter.flush();
    }
  });
  globalThis.addEventListener('pagehide', () => reporter.flush());
}
