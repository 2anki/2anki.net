import { vi } from 'vitest';
import { ImageBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { getImageUrl } from './getImageUrl';

vi.mock('@notionhq/client', () => ({
  isFullBlock: () => true,
}));

function imageBlock(type: string, extra: object): ImageBlockObjectResponse {
  return {
    object: 'block',
    id: 'b',
    type: 'image',
    has_children: false,
    archived: false,
    image: { type, ...extra },
  } as unknown as ImageBlockObjectResponse;
}

describe('getImageUrl', () => {
  test('returns url for external image', () => {
    const block = imageBlock('external', {
      external: { url: 'https://example.com/img.png' },
    });
    expect(getImageUrl(block)).toBe('https://example.com/img.png');
  });

  test('returns url for hosted file image', () => {
    const block = imageBlock('file', {
      file: { url: 'https://s3.example.com/img.png', expiry_time: '' },
    });
    expect(getImageUrl(block)).toBe('https://s3.example.com/img.png');
  });

  test('returns null for unsupported image type instead of a bad URL string', () => {
    const block = imageBlock('unsupported_type' as never, {});
    expect(getImageUrl(block)).toBeNull();
  });
});
