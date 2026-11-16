import { spawnSync, type ChildProcess } from 'node:child_process';

// The conversion pool has no per-job deadline, so a tool that never exits holds
// its worker until the server restarts (2026-11-14: 18 hours). In eleven days
// of prod samples (2026-11-05..16) no whole upload conversion held a worker
// for more than 9 minutes, so ten minutes for one tool call is past anything a
// healthy file needs.
export const TOOL_TIMEOUT_MS = 10 * 60 * 1000;

// Kills the tool once it has run past the limit and leaves the caller's own
// close handler to report it, so a timeout reads as the SIGKILL failure each
// caller already handles.
//
// The tool's direct children go first. LibreOffice's launcher starts the real
// soffice.bin as a child; killing only the launcher would orphan it with the
// output pipes still open, and the close event would never arrive.
export function killOnTimeout(
  child: ChildProcess,
  label: string,
  timeoutMs: number = TOOL_TIMEOUT_MS
): void {
  const timer = setTimeout(() => {
    console.warn(
      `[subprocess] ${label} timed out after ${Math.round(timeoutMs / 1000)}s, killing it`
    );
    if (child.pid != null) {
      spawnSync('pkill', ['-KILL', '-P', String(child.pid)]);
    }
    child.kill('SIGKILL');
  }, timeoutMs);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
}
