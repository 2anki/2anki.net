import { scheduleSync } from './userPreferencesSync';

export const saveValueInLocalStorage = (
  key: string,
  value: string,
  pageId: string | null
) => {
  if (pageId) {
    return;
  }
  localStorage.setItem(key, value);
  scheduleSync();
};
