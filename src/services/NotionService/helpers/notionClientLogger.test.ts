import { LogLevel } from '@notionhq/client';
import { makeNotionClientLogger } from './notionClientLogger';

describe('makeNotionClientLogger', () => {
  it.each([
    'Provided ID abc is a database, not a page. Use the retrieve database API instead.',
    'Provided ID abc is a page, not a database. Use the retrieve page API instead.',
  ])('drops the page/database probe miss the caller handles: %s', (message) => {
    const base = jest.fn();
    const logger = makeNotionClientLogger(base);

    logger(LogLevel.WARN, 'request fail', {
      code: 'validation_error',
      message,
    });

    expect(base).not.toHaveBeenCalled();
  });

  it('passes every other request failure through', () => {
    const base = jest.fn();
    const logger = makeNotionClientLogger(base);
    const extraInfo = {
      code: 'rate_limited',
      message: 'You have been rate limited. Please try again later.',
    };

    logger(LogLevel.WARN, 'request fail', extraInfo);

    expect(base).toHaveBeenCalledWith(LogLevel.WARN, 'request fail', extraInfo);
  });
});
