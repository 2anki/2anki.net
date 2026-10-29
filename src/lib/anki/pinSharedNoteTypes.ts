import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CREATE_DECK_DIR } from '../constants';
import { PYTHON } from './CardGenerator';

const PIN_SCRIPT_PATH = path.join(CREATE_DECK_DIR, 'pin_shared_notetypes.py');
const NOTHING_TO_PIN = 3;
const PIN_TIMEOUT_MS = 20_000;

function runPin(source: string, destination: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON(), [PIN_SCRIPT_PATH, source, destination], {
      cwd: CREATE_DECK_DIR,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), PIN_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(true);
      else if (code === NOTHING_TO_PIN) resolve(false);
      else reject(new Error(`pin_shared_notetypes ended: ${code ?? signal}`));
    });
  });
}

// One at a time: share links are public, so a burst of downloads must not
// start a Python process each. Past a short line, a download skips the pin
// and gets the deck as stored rather than wait behind a slow one.
export const MAX_WAITING_PINS = 2;
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  waiting += 1;
  const run = queue.then(work, work).finally(() => {
    waiting -= 1;
  });
  queue = run.catch(() => undefined);
  return run;
}

// Every 2anki note type id is shared by all users, so a deck built after its
// owner changed a card style would replace the style of anyone who imports it
// (#5043). The copy other people download keeps the shared note-type mod.
export function pinSharedNoteTypes(apkg: Buffer): Promise<Buffer> {
  if (waiting >= MAX_WAITING_PINS) {
    return Promise.resolve(apkg);
  }
  return oneAtATime(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-apkg-'));
    try {
      const source = path.join(dir, 'deck.apkg');
      const destination = path.join(dir, 'shared.apkg');
      await fs.writeFile(source, apkg);
      const pinned = await runPin(source, destination);
      return pinned ? await fs.readFile(destination) : apkg;
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
