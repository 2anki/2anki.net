import DownloadRouter from './DownloadRouter';
import { downloadIdentityMiddleware } from './middleware/optionalAuthMiddleware';

interface RouteLayer {
  route?: { path: string; stack: { handle: unknown }[] };
}

function handlersFor(routePath: string): unknown[] {
  const layers = (DownloadRouter() as unknown as { stack: RouteLayer[] }).stack;
  const layer = layers.find((entry) => entry.route?.path === routePath);
  return layer?.route?.stack.map((entry) => entry.handle) ?? [];
}

// Without the signed-in user these two routes record deck_downloaded under
// the anonymous id only, so the download tripwire never pairs a signed-in
// user's download with their conversion (#5057).
describe('DownloadRouter', () => {
  it.each(['/download/:id/:filename', '/download/:id/bulk'])(
    'resolves a signed-in user, if any, before serving %s',
    (routePath) => {
      const handlers = handlersFor(routePath);

      expect(handlers).toHaveLength(2);
      expect(handlers[0]).toBe(downloadIdentityMiddleware);
    }
  );

  it('keeps the download page open without a session lookup', () => {
    expect(handlersFor('/download/:id')).toHaveLength(1);
  });
});
