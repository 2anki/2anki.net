import { extractPdfText } from './extractPdfText';

// jobFailureReason and isExpectedUploadState match a damaged PDF by the name
// pdf.js gives the error. This pins that name to what the bundled pdf.js
// really throws, so a pdf-parse bump that renames it fails here instead of
// quietly turning the copy back into "unknown".
describe('extractPdfText on bytes that are not a PDF', () => {
  it('rejects with an InvalidPDFException named error', async () => {
    const notAPdf = Buffer.from('this is not a pdf, just text pretending');

    await expect(extractPdfText(notAPdf)).rejects.toMatchObject({
      name: 'InvalidPDFException',
    });
  });
});
