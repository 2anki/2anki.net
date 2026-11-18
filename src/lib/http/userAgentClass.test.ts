import { userAgentClass } from './userAgentClass';

describe('userAgentClass', () => {
  it.each([
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'python-requests/2.32.3',
    'curl/8.7.1',
    'Go-http-client/2.0',
    'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
    'axios/1.7.7',
    'okhttp/4.12.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ])('classes %s as a fetcher', (userAgent) => {
    expect(userAgentClass(userAgent)).toBe('fetcher');
  });

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  ])('classes %s as a browser', (userAgent) => {
    expect(userAgentClass(userAgent)).toBe('browser');
  });

  it.each([undefined, null, '', 'Opera/9.80', 'SomeTool 1.0'])(
    'classes %j as unknown',
    (userAgent) => {
      expect(userAgentClass(userAgent)).toBe('unknown');
    }
  );

  it('classes a very long user agent in linear time', () => {
    const long = `Mozilla/5.0 ${'a'.repeat(1_000_000)}`;
    const started = performance.now();

    expect(userAgentClass(long)).toBe('browser');
    expect(userAgentClass(`${long}!`.replace('Mozilla/', 'X'))).toBe('unknown');
    expect(performance.now() - started).toBeLessThan(500);
  });
});
