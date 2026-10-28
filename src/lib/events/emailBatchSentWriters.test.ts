import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [full]
      : [];
  });
}

// The scheduler gates trust only email_batch_sent rows the server marked, so a
// writer that forgets the marker would make its job look like it never ran.
describe('email_batch_sent writers', () => {
  const writers = sourceFiles(SRC).filter((file) =>
    /name:\s*'email_batch_sent'/.test(fs.readFileSync(file, 'utf8'))
  );

  it('finds the writers it checks', () => {
    expect(writers.length).toBeGreaterThan(0);
  });

  it.each(writers.map((file) => [path.relative(SRC, file), file]))(
    '%s writes the server marker',
    (_name, file) => {
      const source = fs.readFileSync(file, 'utf8');
      const record = source.slice(source.search(/name:\s*'email_batch_sent'/));
      const props = record.slice(0, record.indexOf('});'));

      expect(props).toContain('withServerMarker(');
    }
  );
});
