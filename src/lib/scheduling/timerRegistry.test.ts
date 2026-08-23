import { registerSchedulerTimer, clearSchedulerTimers } from './timerRegistry';

describe('timerRegistry', () => {
  afterEach(() => {
    clearSchedulerTimers();
  });

  it('unrefs and returns the registered handle', () => {
    const handle = setInterval(() => {}, 60_000);
    const unref = jest.spyOn(handle, 'unref');

    const returned = registerSchedulerTimer(handle);

    expect(returned).toBe(handle);
    expect(unref).toHaveBeenCalled();
  });

  it('clears every registered handle and reports the count', () => {
    jest.useFakeTimers();
    const fired = jest.fn();
    registerSchedulerTimer(setInterval(() => fired(), 1000));
    registerSchedulerTimer(setInterval(() => fired(), 1000));

    const cleared = clearSchedulerTimers();
    jest.advanceTimersByTime(5000);

    expect(cleared).toBe(2);
    expect(fired).not.toHaveBeenCalled();
    expect(clearSchedulerTimers()).toBe(0);
    jest.useRealTimers();
  });
});
