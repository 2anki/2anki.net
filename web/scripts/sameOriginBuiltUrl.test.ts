import { describe, it, expect } from 'vitest';
import { sameOriginBuiltUrl } from './sameOriginBuiltUrl';

describe('sameOriginBuiltUrl', () => {
  it('keeps font files same-origin so the CDN base never applies', () => {
    expect(sameOriginBuiltUrl('fonts/Fraunces/Fraunces-600.woff2')).toBe(
      '/fonts/Fraunces/Fraunces-600.woff2'
    );
  });

  it('handles a leading slash the bundler may pass through', () => {
    expect(sameOriginBuiltUrl('/fonts/Fraunces/Fraunces-500.woff2')).toBe(
      '/fonts/Fraunces/Fraunces-500.woff2'
    );
  });

  it('leaves hashed bundle assets on the default CDN base', () => {
    expect(sameOriginBuiltUrl('assets/index-Dr0U61s3.css')).toBeUndefined();
    expect(sameOriginBuiltUrl('assets/index-abc123.js')).toBeUndefined();
  });
});
