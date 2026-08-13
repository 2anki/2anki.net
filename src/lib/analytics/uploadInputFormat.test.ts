import { uploadInputFormat } from './uploadInputFormat';

describe('uploadInputFormat', () => {
  it('returns the lowercased extension of the first file for known formats', () => {
    expect(uploadInputFormat([{ originalname: 'notes.DOCX' }])).toBe('docx');
    expect(uploadInputFormat([{ originalname: 'sheet.xlsx' }])).toBe('xlsx');
    expect(uploadInputFormat([{ originalname: 'deck.pdf' }])).toBe('pdf');
  });

  it('returns other for unrecognized extensions', () => {
    expect(uploadInputFormat([{ originalname: 'weird.xyz' }])).toBe('other');
  });

  it('returns unknown when there is no usable filename', () => {
    expect(uploadInputFormat(undefined)).toBe('unknown');
    expect(uploadInputFormat([])).toBe('unknown');
    expect(uploadInputFormat([{ originalname: 'noextension' }])).toBe(
      'unknown'
    );
    expect(uploadInputFormat([{ originalname: 'trailingdot.' }])).toBe(
      'unknown'
    );
  });
});
