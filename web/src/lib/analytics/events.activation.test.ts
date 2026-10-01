import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_EVENTS } from './events';

const ACTIVATION_EVENTS = ['signup_completed', 'upload_page_viewed'] as const;

describe('activation funnel events', () => {
  it.each(ACTIVATION_EVENTS)('%s is in the web allowlist', (name) => {
    expect(KNOWN_EVENTS.has(name)).toBe(true);
  });

  it.each(ACTIVATION_EVENTS)('%s is in the server allowlist', (name) => {
    const serverSource = readFileSync(
      join(__dirname, '../../../../src/types/AnalyticsEvents.ts'),
      'utf8'
    );
    expect(serverSource).toContain(`'${name}'`);
  });
});
