import { isBotUserAgent } from './isBotUserAgent';

describe('isBotUserAgent', () => {
  it.each([
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'TelegramBot (like TwitterBot)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; YandexSpider/3.0)',
    'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Applebot/0.1',
  ])('treats %s as a bot', (userAgent) => {
    expect(isBotUserAgent(userAgent)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    '',
    null,
    undefined,
  ])('treats %j as a person', (userAgent) => {
    expect(isBotUserAgent(userAgent)).toBe(false);
  });
});
