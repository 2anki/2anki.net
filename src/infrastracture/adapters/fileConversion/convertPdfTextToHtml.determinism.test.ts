import { vi, type MockedFunction } from 'vitest';
import { convertPdfTextToHtmlAuto } from './convertPdfTextToHtml';

vi.mock('pdf-parse', () => ({ default: vi.fn() }));

import pdfParse from 'pdf-parse';

const mockPdfParse = pdfParse as MockedFunction<typeof pdfParse>;

const PAGES = [
  {
    heading: 'Cell structure',
    body: 'The cell is the basic structural and functional unit of all living organisms, bounded by a membrane that regulates the passage of ions, nutrients, and waste between the interior and the surrounding environment.',
  },
  {
    heading: 'Mitochondria',
    body: 'Mitochondria are membrane bound organelles that generate most of the chemical energy needed to power the biochemical reactions of the cell, storing that energy as adenosine triphosphate molecules.',
  },
  {
    heading: 'Photosynthesis',
    body: 'Photosynthesis is the process used by plants, algae, and some bacteria to convert light energy into chemical energy that can later fuel the activities of the organism through cellular respiration.',
  },
];

const FULL_TEXT = PAGES.map((p) => `${p.heading}\n${p.body}`).join('\f');

function mockDeterministicParse() {
  mockPdfParse.mockResolvedValue({
    numpages: PAGES.length,
    text: FULL_TEXT,
    info: {},
    metadata: null,
    version: 'v1.10.100' as const,
    numrender: PAGES.length,
  });
}

describe('non-AI PDF text path determinism', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeterministicParse();
  });

  it('produces the same card count on repeated runs of the same document', async () => {
    const run1 = await convertPdfTextToHtmlAuto(Buffer.from('pdf'), 'bio.pdf');
    const run2 = await convertPdfTextToHtmlAuto(Buffer.from('pdf'), 'bio.pdf');

    expect(run1.isTextShaped).toBe(true);
    expect(run1.cardCount).toBeGreaterThan(1);
    expect(run2.cardCount).toBe(run1.cardCount);
  });

  it('produces byte-identical HTML on repeated runs of the same document', async () => {
    const run1 = await convertPdfTextToHtmlAuto(Buffer.from('pdf'), 'bio.pdf');
    const run2 = await convertPdfTextToHtmlAuto(Buffer.from('pdf'), 'bio.pdf');

    expect(run2.html).toBe(run1.html);
    expect(run2.pageCount).toBe(run1.pageCount);
  });
});
