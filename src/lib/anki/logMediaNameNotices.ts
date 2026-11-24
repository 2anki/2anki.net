export const MEDIA_NAME_NOTICE_PREFIX = '[media-names]';

export function mediaNameNotices(stderr: string): string[] {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(MEDIA_NAME_NOTICE_PREFIX));
}

export function logMediaNameNotices(stderr: string): void {
  for (const notice of mediaNameNotices(stderr)) {
    console.info(notice);
  }
}
