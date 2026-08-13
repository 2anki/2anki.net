import express from 'express';

const FIRST_TOUCH_COOKIE = 'first_touch';
const MAX_AGE_MS = 30 * 60 * 1000;

// The MCP consent page is server-rendered, so the web client's first-touch
// capture never runs for users who arrive from an AI assistant. Without this,
// their eventual signup falls back to the mechanism name (magic_link, google,
// ...) and the MCP channel is invisible in the funnel. Same payload shape and
// lifetime as web/src/lib/firstTouch.ts; parseFirstTouch reads it back.
export function mcpFirstTouchMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  if (cookies?.[FIRST_TOUCH_COOKIE] == null) {
    res.cookie(
      FIRST_TOUCH_COOKIE,
      JSON.stringify({ landingPath: '/mcp', referrer: '' }),
      { maxAge: MAX_AGE_MS, path: '/', sameSite: 'lax' }
    );
  }
  next();
}
