import { excludeExtractionArtifacts } from './excludeExtractionArtifacts';

describe('excludeExtractionArtifacts', () => {
  const archiveCopy = '/tmp/workspaces/w/755758d5-617c-4bf1-a778-34cc0948f728';
  const stdoutLog = '/tmp/workspaces/w/tar_stdout.log';
  const stderrLog = '/tmp/workspaces/w/tar_stderr.log';

  it('drops the uploaded archive copy and the tar logs, keeps extracted files', () => {
    const files = [
      { name: archiveCopy, contents: new Uint8Array([1]) },
      { name: stdoutLog, contents: new Uint8Array([2]) },
      { name: stderrLog, contents: new Uint8Array([3]) },
      {
        name: '/tmp/workspaces/w/Private & Shared/Page abc.html',
        contents: new Uint8Array([4]),
      },
      {
        name: '/tmp/workspaces/w/ExportBlock-abc-Part-1.zip',
        contents: new Uint8Array([5]),
      },
    ];

    const kept = excludeExtractionArtifacts(files, [
      archiveCopy,
      stdoutLog,
      stderrLog,
    ]);

    expect(kept.map((f) => f.name)).toEqual([
      '/tmp/workspaces/w/Private & Shared/Page abc.html',
      '/tmp/workspaces/w/ExportBlock-abc-Part-1.zip',
    ]);
  });

  it('keeps an extracted extensionless page that is not an artifact', () => {
    const kept = excludeExtractionArtifacts(
      [{ name: '/tmp/workspaces/w/Untitled Page', contents: new Uint8Array() }],
      [archiveCopy, stdoutLog, stderrLog]
    );
    expect(kept).toHaveLength(1);
  });
});
