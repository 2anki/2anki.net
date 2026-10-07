import { vi, type Mock } from 'vitest';
import path from 'path';
import {
  writeFile as writeFileModule,
  mkdir as mkdirModule,
} from 'fs/promises';
import { convertPDFToImages } from './convertPDFToImages';
import CardOption from '../../../lib/parser/Settings/CardOption';
import { getPageCount as getPageCountModule } from '../../../lib/pdf/getPageCount';
import { convertPage as convertPageModule } from '../../../lib/pdf/convertPage';

vi.mock('fs/promises', () => ({
  __esModule: true,
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/pdf/getPageCount', () => ({
  getPageCount: vi.fn().mockResolvedValue(2),
}));

vi.mock('../../../lib/pdf/convertPage', () => ({
  convertPage: vi
    .fn()
    .mockImplementation((pdfPath: string, pageNumber: number) =>
      Promise.resolve(`${pdfPath}-page${pageNumber}-${pageNumber}.png`)
    ),
}));

const writeFile = writeFileModule as unknown as Mock;
const mkdir = mkdirModule as unknown as Mock;
const getPageCount = getPageCountModule as unknown as Mock;
const convertPage = convertPageModule as unknown as Mock;

function makeSettings(overrides: Record<string, string> = {}): CardOption {
  return new CardOption({ ...CardOption.LoadDefaultOptions(), ...overrides });
}

const WORKSPACE_LOCATION = '/tmp/race-workspace';

function makeWorkspace(location = WORKSPACE_LOCATION) {
  return { location } as never;
}

describe('convertPDFToImages — concurrent-run isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gives two concurrent calls with the same name distinct pdf write paths', async () => {
    const workspace = makeWorkspace();

    await Promise.all([
      convertPDFToImages({
        name: 'anatomy.pdf',
        workspace,
        noLimits: true,
        contents: Buffer.from('%PDF-1.4 a'),
        settings: makeSettings(),
      }),
      convertPDFToImages({
        name: 'anatomy.pdf',
        workspace,
        noLimits: true,
        contents: Buffer.from('%PDF-1.4 b'),
        settings: makeSettings(),
      }),
    ]);

    const writePaths = (writeFile as Mock).mock.calls.map(
      (call) => call[0] as string
    );
    expect(writePaths).toHaveLength(2);
    expect(writePaths[0]).not.toEqual(writePaths[1]);

    const pageCountPaths = (getPageCount as Mock).mock.calls.map(
      (call) => call[0] as string
    );
    expect(pageCountPaths).toHaveLength(2);
    expect(pageCountPaths[0]).not.toEqual(pageCountPaths[1]);

    for (const writtenPath of writePaths) {
      expect(path.dirname(writtenPath)).not.toEqual(WORKSPACE_LOCATION);
      expect(path.dirname(writtenPath).startsWith(WORKSPACE_LOCATION)).toBe(
        true
      );
    }
  });

  it('creates a unique subdirectory inside the workspace for each call', async () => {
    const workspace = makeWorkspace();

    await convertPDFToImages({
      name: 'notes.pdf',
      workspace,
      noLimits: true,
      contents: Buffer.from('%PDF-1.4'),
      settings: makeSettings(),
    });

    const mkdirCalls = (mkdir as Mock).mock.calls;
    expect(mkdirCalls).toHaveLength(1);
    const createdDir = mkdirCalls[0][0] as string;
    expect(path.dirname(createdDir)).toEqual(WORKSPACE_LOCATION);
    expect(path.basename(createdDir).startsWith('pdf-')).toBe(true);
  });

  it('emits img src paths resolvable from the workspace location', async () => {
    const workspace = makeWorkspace();

    const html = await convertPDFToImages({
      name: 'notes.pdf',
      workspace,
      noLimits: true,
      contents: Buffer.from('%PDF-1.4'),
      settings: makeSettings(),
    });

    const srcMatches = [...html.matchAll(/<img src="([^"]+)"/g)].map(
      (m) => m[1]
    );
    expect(srcMatches.length).toBeGreaterThan(0);
    const pageImagePath = (convertPage as Mock).mock.results[0]
      .value as Promise<string>;
    const resolvedPageImage = await pageImagePath;
    for (const src of srcMatches) {
      expect(src.includes('..')).toBe(false);
      const resolved = path.resolve(WORKSPACE_LOCATION, src);
      expect(resolved.startsWith(WORKSPACE_LOCATION)).toBe(true);
    }
    expect(path.resolve(WORKSPACE_LOCATION, srcMatches[0])).toEqual(
      resolvedPageImage
    );
  });
});
