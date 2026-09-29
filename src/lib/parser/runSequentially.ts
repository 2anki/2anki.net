// One task at a time, in order, for work whose side effects must not
// interleave: card numbering in a deck, one remote image fetch at a time.
export async function runSequentially<T>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<void>
): Promise<void> {
  await items.reduce<Promise<void>>(
    (chain, item, index) => chain.then(() => task(item, index)),
    Promise.resolve()
  );
}
