export class DeadlineExceededError extends Error {
  constructor(ms: number) {
    super(`deadline of ${ms} ms exceeded`);
    this.name = 'DeadlineExceededError';
  }
}

export async function withDeadline<T>(
  ms: number,
  task: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(controller.signal.reason),
      { once: true }
    );
  });
  const timer = setTimeout(
    () => controller.abort(new DeadlineExceededError(ms)),
    ms
  );
  const abortWithParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    abortWithParent();
  } else {
    parent?.addEventListener('abort', abortWithParent, { once: true });
  }

  try {
    return await Promise.race([task(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abortWithParent);
  }
}
