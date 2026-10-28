import crypto from 'node:crypto';

import { extractPdfText } from './extractPdfText';

// The PDF standard security handler, revision 2 (40-bit RC4): small enough to
// build in a test, and opened by the pdf.js build pdf-parse ships.
const PADDING = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex'
);
const PERMISSIONS = -44;

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) % 256];
  }
  return out;
}

function md5(...parts: Buffer[]): Buffer {
  return crypto.createHash('md5').update(Buffer.concat(parts)).digest();
}

function padded(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, 'latin1'), PADDING]).subarray(
    0,
    32
  );
}

function encryptedPdf(userPassword: string, text: string): Buffer {
  const fileId = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const owner = rc4(md5(padded('owner')).subarray(0, 5), padded(userPassword));
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(PERMISSIONS);
  const key = md5(padded(userPassword), owner, permissions, fileId).subarray(
    0,
    5
  );
  const user = rc4(key, PADDING);
  const objectKey = md5(key, Buffer.from([4, 0, 0, 0, 0])).subarray(0, 10);
  const content = rc4(
    objectKey,
    Buffer.from(`BT /F1 18 Tf 20 60 Td (${text}) Tj ET`, 'latin1')
  );

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  const add = (chunk: Buffer | string) => {
    parts.push(
      typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk
    );
  };
  const length = () => parts.reduce((sum, part) => sum + part.length, 0);
  const object = (body: string) => {
    offsets.push(length());
    add(`${offsets.length} 0 obj\n${body}\nendobj\n`);
  };
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
  );
  offsets.push(length());
  add(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`);
  add(content);
  add('\nendstream\nendobj\n');
  object('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  object(
    `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P ${PERMISSIONS} >>`
  );
  const xref = length();
  add(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) {
    add(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  const id = `<${fileId.toString('hex')}>`;
  add(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [${id} ${id}] >>\nstartxref\n${xref}\n%%EOF\n`
  );
  return Buffer.concat(parts);
}

describe('extractPdfText on a password-protected PDF', () => {
  const pdf = encryptedPdf('open-sesame', 'Mitochondria make ATP');

  it('asks for the password when none is given', async () => {
    const result = await extractPdfText(pdf);

    expect(result.needsCredential).toBe(true);
  });

  it('reads the text once the right password is given', async () => {
    const result = await extractPdfText(pdf, { credential: 'open-sesame' });

    expect(result.needsCredential).toBe(false);
    expect(result.pages.map((page) => page.text.trim())).toEqual([
      'Mitochondria make ATP',
    ]);
  });

  it('still asks for the password when the wrong one is given', async () => {
    const result = await extractPdfText(pdf, { credential: 'wrong' });

    expect(result.needsCredential).toBe(true);
  });
});
