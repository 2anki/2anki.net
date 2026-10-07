import { vi, type MockedFunction } from 'vitest';
import { Response } from 'express';

import { sendIndex } from './sendIndex';
import { getIndexFileContents } from './getIndexFileContents';
import { INDEX_HTML_CACHE_CONTROL } from '../../lib/mountWebBuild';

vi.mock('./getIndexFileContents');

const mockedGet = getIndexFileContents as MockedFunction<
  typeof getIndexFileContents
>;

function buildResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('sendIndex', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('sends the html with default 200 status when the build exists', () => {
    mockedGet.mockReturnValue('<html>ready</html>');
    const res = buildResponse();

    sendIndex(res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('<html>ready</html>');
  });

  it('marks the shell no-cache so stale clients pick up new builds', () => {
    mockedGet.mockReturnValue('<html>ready</html>');
    const res = buildResponse();

    sendIndex(res);

    expect(res.set).toHaveBeenCalledWith(
      'Cache-Control',
      INDEX_HTML_CACHE_CONTROL
    );
  });

  it('responds 503 with Retry-After when the build is mid-deploy', () => {
    mockedGet.mockReturnValue(null);
    const res = buildResponse();

    sendIndex(res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '5');
    expect(res.send).toHaveBeenCalledTimes(1);
  });
});
