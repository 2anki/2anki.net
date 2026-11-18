import { describe, expect, it } from 'vitest';
import { markConnectorReturn } from './markConnectorReturn';

describe('markConnectorReturn', () => {
  it.each([
    ['/pricing?ref=mcp', '/pricing?ref=mcp&r=1'],
    ['/pricing/?ref=mcp&k=held&a=a', '/pricing/?ref=mcp&k=held&a=a&r=1'],
    ['/pricing?ref=mcp&r=1', '/pricing?ref=mcp&r=1'],
    ['/pricing?ref=mcp&r=2&r=1', '/pricing?ref=mcp&r=1'],
    ['/pricing?ref=mcp#auto-sync', '/pricing?ref=mcp&r=1#auto-sync'],
  ])('marks %s as %s', (redirect, marked) => {
    expect(markConnectorReturn(redirect)).toBe(marked);
  });

  it.each([
    undefined,
    '/pricing',
    '/pricing?ref=MCP',
    '/pricing?interval=year',
    '/upload?ref=mcp',
    '/pricingX?ref=mcp',
  ])('leaves %j as it is', (redirect) => {
    expect(markConnectorReturn(redirect)).toBe(redirect);
  });
});
