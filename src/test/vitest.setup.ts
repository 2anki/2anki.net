import os from 'node:os';
import path from 'node:path';

process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'workspaces');
