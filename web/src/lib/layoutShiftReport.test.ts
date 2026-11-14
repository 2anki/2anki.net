// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./analytics/track', () => ({ track: vi.fn() }));

import { track } from './analytics/track';
import {
  LayoutShiftReporter,
  LayoutShiftSummary,
  LayoutShiftTally,
  ShiftSample,
  shiftPath,
  shiftTarget,
  startLayoutShiftReport,
} from './layoutShiftReport';

function sample(overrides: Partial<ShiftSample>): ShiftSample {
  return {
    value: 0.05,
    startTime: 1000,
    path: '/print',
    target: 'footer.Footer.footer',
    ...overrides,
  };
}

describe('shiftPath', () => {
  it.each([
    ['/', '/'],
    ['/print/', '/print'],
    ['/convert/apkg-to-csv/', '/convert/apkg-to-csv'],
    ['/mindmaps/4821', '/mindmaps/:id'],
    ['/users/r/abcdefghijklmnopqrstuvwxyzABCDEF', '/users/r/:id'],
    ['/s/9f8e7d6c', '/s/:id'],
    ['/documentation/reference/mcp/', '/documentation/reference/mcp'],
  ])('reports %s as %s', (pathname, expected) => {
    expect(shiftPath(pathname)).toBe(expected);
  });
});

describe('shiftTarget', () => {
  it('cuts a CSS module class down to its file and local name', () => {
    const footer = document.createElement('footer');
    footer.className = 'Footer-module__footer___I47BE other';

    expect(shiftTarget(footer)).toBe('footer.Footer.footer');
  });

  it('keeps a plain class as it is', () => {
    const div = document.createElement('div');
    div.className = 'hero';

    expect(shiftTarget(div)).toBe('div.hero');
  });

  it('names an element with no class by its tag', () => {
    expect(shiftTarget(document.createElement('main'))).toBe('main');
  });

  it('names a text node by its parent element', () => {
    const paragraph = document.createElement('p');
    paragraph.className = 'lead';
    const text = document.createTextNode('never reported');
    paragraph.append(text);

    expect(shiftTarget(text)).toBe('p.lead');
  });

  it('says so when the node is gone', () => {
    expect(shiftTarget(null)).toBe('removed');
  });

  it('caps a long class name at 60 characters', () => {
    const div = document.createElement('div');
    div.className = 'x'.repeat(200);

    expect(shiftTarget(div)).toHaveLength(60);
  });
});

describe('LayoutShiftTally', () => {
  it('has nothing to report before any shift', () => {
    expect(new LayoutShiftTally().summary()).toBeNull();
  });

  it('adds up shifts under a second apart', () => {
    const tally = new LayoutShiftTally();
    tally.add(sample({ value: 0.04, startTime: 1000 }));
    tally.add(sample({ value: 0.07, startTime: 1800 }));

    expect(tally.summary()).toMatchObject({ value: 0.11, shifts: 2 });
  });

  it('scores the largest burst, not the total, when shifts are far apart', () => {
    const tally = new LayoutShiftTally();
    tally.add(sample({ value: 0.04, startTime: 1000 }));
    tally.add(sample({ value: 0.07, startTime: 2500 }));
    tally.add(sample({ value: 0.02, startTime: 9000 }));

    expect(tally.summary()).toMatchObject({ value: 0.07, shifts: 3 });
  });

  it('starts a new burst once one has run for five seconds', () => {
    const tally = new LayoutShiftTally();
    for (const startTime of [0, 900, 1800, 2700, 3600, 4500]) {
      tally.add(sample({ value: 0.02, startTime }));
    }
    tally.add(sample({ value: 0.02, startTime: 5400 }));

    expect(tally.summary()).toMatchObject({ value: 0.12, shifts: 7 });
  });

  it('names the single largest shift, where and when it happened', () => {
    const tally = new LayoutShiftTally();
    tally.add(sample({ value: 0.03, startTime: 400.4, path: '/' }));
    tally.add(
      sample({
        value: 0.21,
        startTime: 6200.6,
        path: '/upload',
        target: 'div.UploadForm.stateContent',
      })
    );
    tally.add(sample({ value: 0.05, startTime: 9000, path: '/downloads' }));

    expect(tally.summary()).toEqual({
      value: 0.21,
      worst_value: 0.21,
      worst_ms: 6201,
      worst_path: '/upload',
      worst_target: 'div.UploadForm.stateContent',
      shifts: 3,
    });
  });
});

describe('LayoutShiftReporter', () => {
  function build() {
    const tally = new LayoutShiftTally();
    const sent: LayoutShiftSummary[] = [];
    const reporter = new LayoutShiftReporter(tally, (summary) => {
      sent.push(summary);
    });
    return { tally, sent, reporter };
  }

  it('sends nothing for a page that never shifted', () => {
    const { reporter, sent } = build();

    reporter.flush();

    expect(sent).toEqual([]);
  });

  it('sends nothing while the score is under 0.1', () => {
    const { tally, reporter, sent } = build();
    tally.add(sample({ value: 0.099 }));

    reporter.flush();

    expect(sent).toEqual([]);
  });

  it('sends the summary once the score reaches 0.1', () => {
    const { tally, reporter, sent } = build();
    tally.add(sample({ value: 0.1 }));

    reporter.flush();

    expect(sent).toEqual([
      {
        value: 0.1,
        worst_value: 0.1,
        worst_ms: 1000,
        worst_path: '/print',
        worst_target: 'footer.Footer.footer',
        shifts: 1,
      },
    ]);
  });

  it('does not send the same score twice', () => {
    const { tally, reporter, sent } = build();
    tally.add(sample({ value: 0.15 }));

    reporter.flush();
    reporter.flush();

    expect(sent).toHaveLength(1);
  });

  it('sends again when the score has grown', () => {
    const { tally, reporter, sent } = build();
    tally.add(sample({ value: 0.15, startTime: 1000 }));
    reporter.flush();
    tally.add(sample({ value: 0.3, startTime: 8000 }));

    reporter.flush();

    expect(sent.map((summary) => summary.value)).toEqual([0.15, 0.3]);
  });

  it('stops after three reports for one page', () => {
    const { tally, reporter, sent } = build();
    for (const [index, value] of [0.1, 0.2, 0.3, 0.4, 0.5].entries()) {
      tally.add(sample({ value, startTime: index * 10_000 }));
      reporter.flush();
    }

    expect(sent.map((summary) => summary.value)).toEqual([0.1, 0.2, 0.3]);
  });
});

describe('startLayoutShiftReport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete document.documentElement.dataset.auth;
  });

  it('does nothing in a browser without layout shift entries', () => {
    vi.stubGlobal('PerformanceObserver', undefined);

    expect(() => startLayoutShiftReport()).not.toThrow();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(track).not.toHaveBeenCalled();
  });

  it('reports a page that shifted when the visitor leaves it', () => {
    let deliver: (entries: unknown[]) => void = () => {};
    class FakeObserver {
      static readonly supportedEntryTypes = ['layout-shift'];
      constructor(callback: (list: { getEntries: () => unknown[] }) => void) {
        deliver = (entries) => callback({ getEntries: () => entries });
      }
      observe(): void {}
    }
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    document.documentElement.dataset.auth = '1';
    const footer = document.createElement('footer');
    footer.className = 'Footer-module__footer___I47BE';

    startLayoutShiftReport();
    deliver([
      { value: 0.5, startTime: 200, hadRecentInput: true, sources: [] },
      {
        value: 0.14,
        startTime: 1500,
        hadRecentInput: false,
        sources: [{ node: footer }],
      },
    ]);
    globalThis.dispatchEvent(new Event('pagehide'));

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('layout_shift_reported', {
      value: 0.14,
      worst_value: 0.14,
      worst_ms: 1500,
      worst_path: '/',
      worst_target: 'footer.Footer.footer',
      shifts: 1,
      page_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      viewport_width: 1440,
      viewport_height: 900,
      signed_in: true,
    });
  });
});
