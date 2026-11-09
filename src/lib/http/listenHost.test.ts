import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { listenHost } from './listenHost';

function listen(host: string | undefined): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, host, () => resolve(server));
  });
}

describe('listenHost', () => {
  it('keeps production behind Apache, reachable on the loopback only', async () => {
    const server = await listen(listenHost('production'));
    const { address } = server.address() as AddressInfo;
    server.close();

    expect(address).toBe('127.0.0.1');
  });

  it.each(['development', 'test', undefined])(
    'leaves the default bind for NODE_ENV %s, so local clients on any loopback name connect',
    (nodeEnv) => {
      expect(listenHost(nodeEnv)).toBeUndefined();
    }
  );
});
