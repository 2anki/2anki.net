import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadEditedApkg } from './downloadEditedApkg';

describe('downloadEditedApkg', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('carries the HTTP status, so an expired upload is not reported as a crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Upload not found.' }), {
          status: 404,
        })
      )
    );

    await expect(downloadEditedApkg('1-2-3.apkg', [])).rejects.toMatchObject({
      message: 'Upload not found.',
      status: 404,
    });
  });
});
