const BOT_USER_AGENT_PATTERN = /bot|crawler|spider|slurp|applebot|leikibot/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return userAgent != null && BOT_USER_AGENT_PATTERN.test(userAgent);
}
