import type { Logger } from '@notionhq/client';
import { isNotionDatabaseNotPageError } from './isNotionDatabaseNotPageError';
import { isNotionPageNotDatabaseError } from './isNotionPageNotDatabaseError';

const consoleLogger: Logger = (level, message, extraInfo) => {
  console[level](`@notionhq/client ${level}:`, message, extraInfo);
};

export function makeNotionClientLogger(base: Logger = consoleLogger): Logger {
  return (level, message, extraInfo) => {
    if (
      isNotionDatabaseNotPageError(extraInfo) ||
      isNotionPageNotDatabaseError(extraInfo)
    ) {
      return;
    }
    base(level, message, extraInfo);
  };
}
