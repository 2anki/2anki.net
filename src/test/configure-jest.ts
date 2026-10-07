import { vi } from 'vitest';
import path from 'path';
import os from 'os';

export const setupTests = () => {
  process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'workspaces');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'time').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
};
