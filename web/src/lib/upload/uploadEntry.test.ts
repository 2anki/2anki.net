import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPLOAD_ARRIVAL_WINDOW_MS,
  chooseUploadFile,
  registerUploadEntry,
  resetUploadEntryForTests,
} from './uploadEntry';
import { reportUploadZoneActivity } from './uploadZoneActivity';

function fakeEntry() {
  return { openPicker: vi.fn(), showZone: vi.fn() };
}

beforeEach(() => {
  resetUploadEntryForTests();
  reportUploadZoneActivity('absent');
});

describe('choosing an upload file from outside the upload zone', () => {
  it('opens the file picker when the zone on the page is idle', () => {
    const zone = fakeEntry();
    registerUploadEntry(zone);
    reportUploadZoneActivity('idle');

    expect(chooseUploadFile()).toBe('picker');
    expect(zone.openPicker).toHaveBeenCalledTimes(1);
    expect(zone.showZone).not.toHaveBeenCalled();
  });

  it('brings a busy zone into view without opening the picker', () => {
    const zone = fakeEntry();
    registerUploadEntry(zone);
    reportUploadZoneActivity('busy');

    expect(chooseUploadFile()).toBe('zone');
    expect(zone.showZone).toHaveBeenCalledTimes(1);
    expect(zone.openPicker).not.toHaveBeenCalled();
  });

  it('asks for the upload page when no zone is on the page, and shows its zone once it mounts', () => {
    expect(chooseUploadFile()).toBe('page');

    const zone = fakeEntry();
    registerUploadEntry(zone);
    expect(zone.showZone).toHaveBeenCalledTimes(1);

    const later = fakeEntry();
    registerUploadEntry(later);
    expect(later.showZone).not.toHaveBeenCalled();
  });

  it('forgets the request when no upload zone mounts soon after it', () => {
    expect(chooseUploadFile(1_000)).toBe('page');

    const zone = fakeEntry();
    registerUploadEntry(zone, 1_000 + UPLOAD_ARRIVAL_WINDOW_MS + 1);

    expect(zone.showZone).not.toHaveBeenCalled();
    const later = fakeEntry();
    registerUploadEntry(later, 1_000 + UPLOAD_ARRIVAL_WINDOW_MS + 2);
    expect(later.showZone).not.toHaveBeenCalled();
  });

  it('forgets a zone once it unmounts', () => {
    const unregister = registerUploadEntry(fakeEntry());
    unregister();

    expect(chooseUploadFile()).toBe('page');
  });
});
