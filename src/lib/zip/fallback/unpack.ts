import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

import { excludeExtractionArtifacts } from './excludeExtractionArtifacts';
import { listFiles } from './listFiles';
import { File } from './types';

const TAR_PATH = '/usr/bin/bsdtar';

export function unpack(filePath: string, workspace: string): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const stdoutLogPath = join(workspace, 'tar_stdout.log');
    const stderrLogPath = join(workspace, 'tar_stderr.log');

    const stdoutStream = createWriteStream(stdoutLogPath, { flags: 'a' });
    const stderrStream = createWriteStream(stderrLogPath, { flags: 'a' });

    const decompressProcess = spawn(TAR_PATH, ['xvf', filePath], {
      cwd: workspace,
    });

    decompressProcess.stdout.pipe(stdoutStream);
    decompressProcess.stderr.pipe(stderrStream);

    decompressProcess.on('close', () => {
      // We are not reading the status code because we support partial extraction
      listFiles(workspace)
        .then((files) =>
          resolve(
            excludeExtractionArtifacts(files, [
              filePath,
              stdoutLogPath,
              stderrLogPath,
            ])
          )
        )
        .catch(reject);
    });
  });
}
