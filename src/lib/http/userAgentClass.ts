import { isBotUserAgent } from './isBotUserAgent';

export type UserAgentClass = 'browser' | 'fetcher' | 'unknown';

const FETCHER_PATTERN =
  /-user\/|claude-user|chatgpt-user|facebookexternalhit|whatsapp|python-requests|curl\/|go-http-client|node-fetch|axios\/|okhttp|headlesschrome|googleother|skypeuripreview/i;

const BROWSER_PREFIX = 'Mozilla/';

export function userAgentClass(
  userAgent: string | null | undefined
): UserAgentClass {
  if (userAgent == null || userAgent === '') {
    return 'unknown';
  }
  if (isBotUserAgent(userAgent) || FETCHER_PATTERN.test(userAgent)) {
    return 'fetcher';
  }
  return userAgent.startsWith(BROWSER_PREFIX) ? 'browser' : 'unknown';
}
