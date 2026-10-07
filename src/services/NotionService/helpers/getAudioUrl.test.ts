import { vi } from 'vitest';
import { AudioBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { getAudioUrl } from './getAudioUrl';

vi.mock('@notionhq/client', () => ({
  isFullBlock: () => true,
}));

function audioBlock(type: string, extra: object): AudioBlockObjectResponse {
  return {
    object: 'block',
    id: 'b',
    type: 'audio',
    has_children: false,
    archived: false,
    audio: { type, ...extra },
  } as unknown as AudioBlockObjectResponse;
}

describe('getAudioUrl', () => {
  test('returns url for external audio', () => {
    const block = audioBlock('external', {
      external: { url: 'https://example.com/clip.mp3' },
    });
    expect(getAudioUrl(block)).toBe('https://example.com/clip.mp3');
  });

  test('returns url for hosted file audio', () => {
    const block = audioBlock('file', {
      file: { url: 'https://s3.example.com/clip.mp3', expiry_time: '' },
    });
    expect(getAudioUrl(block)).toBe('https://s3.example.com/clip.mp3');
  });

  test('returns null for unsupported audio type instead of a bad URL string', () => {
    const block = audioBlock('unsupported_type' as never, {});
    expect(getAudioUrl(block)).toBeNull();
  });
});
