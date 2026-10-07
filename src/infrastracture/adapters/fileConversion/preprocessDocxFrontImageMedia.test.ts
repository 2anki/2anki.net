import { vi, type Mock } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as cheerio from 'cheerio';

vi.mock('mammoth', () => {
  const imgElement = vi.fn((handler) => ({
    __brand: 'imgElement',
    handler,
  }));
  return {
    __esModule: true,
    default: {
      convertToHtml: vi.fn(),
      images: { imgElement },
    },
  };
});

import mammoth from 'mammoth';
import { convertDocxToHTML } from './convertDocxToHTML';
import { createWorkspaceDocxImageMediaSink } from './docxImageMediaSink';
import { embedFile } from '../../../lib/parser/exporters/embedFile';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Workspace from '../../../lib/parser/WorkSpace';
import { isImageFileEmbedable } from '../../../lib/storage/checks';

const mockedConvert = mammoth.convertToHtml as Mock;

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('docx heading image becomes front media', () => {
  let workspaceDir: string;

  beforeEach(() => {
    mockedConvert.mockReset();
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-front-'));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('packages an image in a heading as real apkg media on the card front', async () => {
    mockedConvert.mockImplementation(async (_input, options) => {
      const attrs = await options.convertImage.handler({
        contentType: 'image/png',
        readAsBuffer: async () => PNG_BYTES,
      });
      return {
        value: `<h2><img src="${attrs.src}" /></h2><p>The heart pumps blood.</p>`,
        messages: [],
      };
    });

    const sink = createWorkspaceDocxImageMediaSink(workspaceDir);
    const html = await convertDocxToHTML(Buffer.from('docx'), sink);

    expect(html).not.toContain('data:image');

    const dom = cheerio.load(html);
    const summaryImg = dom('summary img').attr('src');
    expect(summaryImg).toBeDefined();
    expect(summaryImg).not.toContain('data:image');
    expect(isImageFileEmbedable(summaryImg!)).toBe(true);

    expect(fs.existsSync(path.join(workspaceDir, summaryImg!))).toBe(true);

    const workspace = Object.create(Workspace.prototype) as Workspace;
    workspace.location = workspaceDir;
    const exporter = new CustomExporter('deck', workspaceDir);

    const packagedName = embedFile({
      exporter,
      files: [],
      filePath: summaryImg!,
      workspace,
      fallbackWorkspaceLocation: workspaceDir,
    });

    expect(packagedName).not.toBeNull();
    expect(exporter.media).toHaveLength(1);
    const packagedBytes = fs.readFileSync(exporter.media[0]);
    expect(packagedBytes).toEqual(PNG_BYTES);
  });
});
