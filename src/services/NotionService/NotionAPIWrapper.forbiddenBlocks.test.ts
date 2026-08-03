import { APIErrorCode, APIResponseError } from '@notionhq/client';

import NotionAPIWrapper from './NotionAPIWrapper';

function makeApiError(
  code: APIErrorCode,
  status: number,
  message: string
): APIResponseError {
  const err = new Error(message);
  Object.setPrototypeOf(err, APIResponseError.prototype);
  Object.assign(err, { code, status, name: 'APIResponseError' });
  return err as unknown as APIResponseError;
}

function setNotion(wrapper: NotionAPIWrapper, notion: unknown): void {
  (wrapper as unknown as { notion: unknown }).notion = notion;
}

describe('NotionAPIWrapper forbidden block counting', () => {
  test('counts a restricted_resource 403 from getBlocks and rethrows it unchanged', async () => {
    const wrapper = new NotionAPIWrapper('test-token', '1');
    const error = makeApiError(
      APIErrorCode.RestrictedResource,
      403,
      'Access to this block is restricted'
    );
    setNotion(wrapper, {
      blocks: {
        children: {
          list: jest.fn(async () => {
            throw error;
          }),
        },
      },
    });

    await expect(
      wrapper.getBlocks({
        createdAt: '2026-08-01T00:00:00.000Z',
        lastEditedAt: '2026-08-02T00:00:00.000Z',
        id: 'block-a',
        all: true,
        type: 'page',
      })
    ).rejects.toBe(error);

    expect(wrapper.forbiddenBlockCount).toBe(1);
  });

  test('counts a restricted_resource 403 from getBlock and rethrows it unchanged', async () => {
    const wrapper = new NotionAPIWrapper('test-token', '1');
    const error = makeApiError(
      APIErrorCode.RestrictedResource,
      403,
      'Access to this block is restricted'
    );
    setNotion(wrapper, {
      blocks: {
        retrieve: jest.fn(async () => {
          throw error;
        }),
      },
    });

    await expect(wrapper.getBlock('block-a')).rejects.toBe(error);
    expect(wrapper.forbiddenBlockCount).toBe(1);
  });

  test('counts two 403s on the same block id only once', async () => {
    const wrapper = new NotionAPIWrapper('test-token', '1');
    const error = makeApiError(
      APIErrorCode.RestrictedResource,
      403,
      'Access to this block is restricted'
    );
    setNotion(wrapper, {
      blocks: {
        children: {
          list: jest.fn(async () => {
            throw error;
          }),
        },
      },
    });

    const params = {
      createdAt: '2026-08-01T00:00:00.000Z',
      lastEditedAt: '2026-08-02T00:00:00.000Z',
      id: 'block-a',
      all: true,
      type: 'page' as const,
    };
    await expect(wrapper.getBlocks(params)).rejects.toBe(error);
    await expect(wrapper.getBlocks(params)).rejects.toBe(error);

    expect(wrapper.forbiddenBlockCount).toBe(1);
  });

  test('does not count a non-403 error', async () => {
    const wrapper = new NotionAPIWrapper('test-token', '1');
    const error = makeApiError(
      APIErrorCode.ObjectNotFound,
      404,
      'Could not find block'
    );
    setNotion(wrapper, {
      blocks: {
        children: {
          list: jest.fn(async () => {
            throw error;
          }),
        },
      },
    });

    await expect(
      wrapper.getBlocks({
        createdAt: '2026-08-01T00:00:00.000Z',
        lastEditedAt: '2026-08-02T00:00:00.000Z',
        id: 'block-a',
        all: true,
        type: 'page',
      })
    ).rejects.toBe(error);

    expect(wrapper.forbiddenBlockCount).toBe(0);
  });
});
