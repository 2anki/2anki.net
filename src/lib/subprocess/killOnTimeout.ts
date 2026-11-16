import { spawnSync, type ChildProcess } from 'node:child_process';

// The conversion pool has no per-job deadline, so a tool that never exits holds
// its worker until the server restarts (2026-11-14: 18 hours). Across 3,298
// conversions on prod (2026-11-05..16) the whole tool phase of one upload, every
// call to every tool together, took under 10 seconds in 3,239 and 216 seconds
// at most, apart from the two that hung. Ten minutes for a single call is
// nearly three times the slowest healthy upload.
export const TOOL_TIMEOUT_MS = 10 * 60 * 1000;

const PKILL_TIMEOUT_MS = 5000;

function stillRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function arm(
  child: ChildProcess,
  label: string,
  timeoutMs: number,
  killChildren: (pid: number) => void
): void {
  const timer = setTimeout(() => {
    console.warn(
      `[subprocess] ${label} pid=${child.pid ?? 'unknown'} timed out after ${Math.round(timeoutMs / 1000)}s, killing it`
    );
    // Node clears these two fields when it reaps the tool, so while both are
    // null the pid still belongs to it. Past that the pid may already be
    // another process's, and nothing is sent to it.
    if (child.pid != null && stillRunning(child)) {
      killChildren(child.pid);
      child.kill('SIGKILL');
    }
    // The close event waits for the output pipes, and a process the tool
    // started can outlive it holding them. Closing our ends lets the caller's
    // close handler run either way.
    child.stdout?.destroy();
    child.stderr?.destroy();
  }, timeoutMs);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
}

// Kills the tool once it has run past the limit and leaves the caller's own
// close handler to report it, so a timeout reads as the SIGKILL failure each
// caller already handles.
export function killOnTimeout(
  child: ChildProcess,
  label: string,
  timeoutMs: number = TOOL_TIMEOUT_MS
): void {
  arm(child, label, timeoutMs, () => {});
}

// For a tool that does its work in a child process. LibreOffice's launcher
// starts the real soffice.bin as a child, and killing only the launcher would
// leave that running, so its direct children are killed first.
export function killTreeOnTimeout(
  child: ChildProcess,
  label: string,
  timeoutMs: number = TOOL_TIMEOUT_MS
): void {
  arm(child, label, timeoutMs, (pid) => {
    spawnSync('pkill', ['-KILL', '-P', String(pid)], {
      stdio: 'ignore',
      timeout: PKILL_TIMEOUT_MS,
    });
  });
}
