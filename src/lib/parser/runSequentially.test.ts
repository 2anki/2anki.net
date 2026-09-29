import { runSequentially } from './runSequentially';

describe('runSequentially', () => {
  it('runs tasks one after another in item order', async () => {
    const events: string[] = [];
    await runSequentially(['a', 'b', 'c'], async (item, index) => {
      events.push(`start ${item}${index}`);
      await new Promise((resolve) => setTimeout(resolve, 3 - index));
      events.push(`end ${item}${index}`);
    });

    expect(events).toEqual([
      'start a0',
      'end a0',
      'start b1',
      'end b1',
      'start c2',
      'end c2',
    ]);
  });

  it('stops at the first rejection and surfaces it', async () => {
    const seen: number[] = [];
    await expect(
      runSequentially([1, 2, 3], async (n) => {
        seen.push(n);
        if (n === 2) throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(seen).toEqual([1, 2]);
  });

  it('resolves immediately for no items', async () => {
    const task = jest.fn();
    await runSequentially([], task);
    expect(task).not.toHaveBeenCalled();
  });
});
