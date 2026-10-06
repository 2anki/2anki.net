// Conversions run in forked child processes with a bounded V8 old-generation
// heap. Both the pool (which passes it as the child's execArgv) and the zip
// extractor (which sizes its own in-memory / decompressed ceilings below it)
// need this number, so it lives in a dependency-free leaf module — importing
// conversionPool.ts into the extraction hot path would drag the Notion client
// and the scheduler into it.
export const MAX_OLD_GENERATION_SIZE_MB = 1024;

// Child execArgv entry that caps V8's old generation. The pool strips
// NODE_OPTIONS from the child env (so the 16G main-process ceiling is not
// inherited) and passes this instead, so the child heap is bounded independently
// of the main process.
export const CONVERSION_CHILD_MAX_OLD_SPACE_ARG = `--max-old-space-size=${MAX_OLD_GENERATION_SIZE_MB}`;

// After a task completes, a child whose reported RSS is at or above this retires
// gracefully — drains its events sink, destroys its DB pool and exits — so the
// next task starts in a fresh process and whatever the conversion stranded goes
// back to the OS. Set above the ~1GB V8 heap cap to leave native/buffer headroom
// for one in-flight conversion, and well below the hard guard ceiling.
export const CONVERSION_CHILD_RETIRE_RSS_MB = 1536;

// Hard per-child ceiling the parent watches via /proc/<pid>/status every 5s.
// pm2's max_memory_restart only sees the main pid, so a child that balloons
// mid-task on native malloc (which the V8 cap cannot bound) would otherwise be
// invisible until the box OOMs. CONVERSION_WORKERS children at this ceiling plus
// the ~450MB main process stay well under the box's 32G alongside Postgres.
// Ships log-only first: the parent logs a crossing; a follow-up flips it to a
// process-group kill once the log confirms the ceiling is right.
export const CONVERSION_CHILD_GUARD_RSS_MB = 3072;
