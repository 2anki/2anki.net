import path from 'node:path';

export interface ConversionWorkerEntry {
  filename: string;
  execArgv: string[];
}

// Pick the worker build that matches the running module. Production runs the
// compiled `.js`, but `tsc` writes it next to the `.ts` source, so choosing by
// "does the .ts exist" booted every prod worker through tsx and recompiled the
// whole import graph after each pool recycle.
export function resolveConversionWorkerEntry(
  callerFilename: string
): ConversionWorkerEntry {
  const dir = path.dirname(callerFilename);
  if (callerFilename.endsWith('.ts')) {
    return {
      filename: path.join(dir, 'conversionWorker.ts'),
      execArgv: ['--require', 'tsx/cjs'],
    };
  }
  return { filename: path.join(dir, 'conversionWorker.js'), execArgv: [] };
}
