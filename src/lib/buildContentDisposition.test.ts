import http from 'http';
import { buildContentDisposition } from './buildContentDisposition';

describe('buildContentDisposition', () => {
  it('handles plain ASCII filename', () => {
    expect(buildContentDisposition('report.apkg')).toBe(
      'attachment; filename="report.apkg"; filename*=UTF-8\'\'report.apkg'
    );
  });

  it('handles umlaut filename with ASCII fallback and percent-encoded filename*', () => {
    const result = buildContentDisposition('Speicheldrüsen.apkg');
    expect(result).toMatch(/^attachment; filename="Speicheldr_sen\.apkg"/);
    expect(result).toContain("filename*=UTF-8''Speicheldr%C3%BCsen.apkg");
  });

  it('handles CJK filename', () => {
    const result = buildContentDisposition('漢字.apkg');
    expect(result).toMatch(/^attachment; filename="[^"]*"/);
    expect(result).toContain("filename*=UTF-8''%E6%BC%A2%E5%AD%97.apkg");
  });

  it('handles Cyrillic filename', () => {
    const result = buildContentDisposition('Здравствуйте.apkg');
    expect(result).toMatch(/^attachment; filename="[^"]*"/);
    expect(result).toContain(
      "filename*=UTF-8''%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5.apkg"
    );
  });

  it('handles emoji filename', () => {
    const result = buildContentDisposition('📚.apkg');
    expect(result).toMatch(/^attachment; filename="[^"]*"/);
    expect(result).toContain("filename*=UTF-8''%F0%9F%93%9A.apkg");
  });

  it('strips double-quotes from ASCII fallback to avoid breaking header parsing', () => {
    const result = buildContentDisposition('Some "Quoted" Name.apkg');
    expect(result).not.toMatch(/filename="[^"]*"[^;]/);
    expect(result).toMatch(/filename="Some _Quoted_ Name\.apkg"/);
    expect(result).toContain(
      "filename*=UTF-8''Some%20%22Quoted%22%20Name.apkg"
    );
  });

  it('percent-encodes characters RFC 5987 does not allow in filename*', () => {
    const result = buildContentDisposition("Dad's (draft)*.pdf");
    expect(result).toContain("filename*=UTF-8''Dad%27s%20%28draft%29%2A.pdf");
  });

  it('carries a Turkish name through filename*', () => {
    const result = buildContentDisposition('PEDİATRİ.pdf');
    expect(result).toMatch(/^attachment; filename="PED_ATR_\.pdf"/);
    expect(decodeURIComponent(result.split("UTF-8''")[1])).toBe('PEDİATRİ.pdf');
  });

  it('strips backslash from ASCII fallback', () => {
    const result = buildContentDisposition('path\\to\\file.apkg');
    expect(result).toMatch(/filename="path_to_file\.apkg"/);
    expect(result).toContain("filename*=UTF-8''path%5Cto%5Cfile.apkg");
  });

  it('produces a header value that is a legal HTTP header byte sequence', () => {
    const inputs = [
      'report.apkg',
      'Speicheldrüsen.apkg',
      '漢字.apkg',
      'Здравствуйте.apkg',
      '📚.apkg',
      'Some "Quoted" Name.apkg',
      'path\\to\\file.apkg',
    ];
    for (const input of inputs) {
      const value = buildContentDisposition(input);
      expect(() =>
        http.validateHeaderValue('Content-Disposition', value)
      ).not.toThrow();
    }
  });
});
