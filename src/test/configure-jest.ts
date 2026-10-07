import path from 'path';
import os from 'os';

const mocker =
  (globalThis as typeof globalThis & { vi?: typeof jest }).vi ?? jest;

export const setupTests = () => {
  process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'workspaces');
  mocker.spyOn(console, 'log').mockImplementation(() => {});
  mocker.spyOn(console, 'time').mockImplementation(() => {});
  mocker.spyOn(console, 'debug').mockImplementation(() => {});
  mocker.spyOn(console, 'error').mockImplementation(() => {});
  mocker.spyOn(console, 'warn').mockImplementation(() => {});
};
