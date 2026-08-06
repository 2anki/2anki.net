import {
  resolveNotionS3ImageFromZip,
  isNotionSignedFileUrl,
} from './resolveNotionS3ImageFromZip';
import { File } from '../../zip/zip';

const makeFile = (name: string, contents: string): File =>
  ({ name, contents }) as File;

describe('resolveNotionS3ImageFromZip', () => {
  const zipFiles: File[] = [
    makeFile('My Topic/screenshot_1.png', 'png-bytes-1'),
    makeFile('My Topic/diagram.jpg', 'jpg-bytes'),
    makeFile('Other/unrelated.pdf', 'pdf-bytes'),
  ];

  it('matches a Notion S3 URL by the encoded filename in the URL path', () => {
    const url =
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace-id/file-id/screenshot_1.png?X-Amz-Expires=3600&X-Amz-Signature=abc';
    const result = resolveNotionS3ImageFromZip(url, zipFiles);
    expect(result).toEqual(
      makeFile('My Topic/screenshot_1.png', 'png-bytes-1')
    );
  });

  it('returns null for a non-Notion URL', () => {
    const result = resolveNotionS3ImageFromZip(
      'https://example.com/image.png',
      zipFiles
    );
    expect(result).toBeNull();
  });

  it('returns null when no ZIP entry matches the filename', () => {
    const url =
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace-id/file-id/missing.png?X-Amz-Expires=3600';
    const result = resolveNotionS3ImageFromZip(url, zipFiles);
    expect(result).toBeNull();
  });

  it('returns null for a relative path (non-S3 URL)', () => {
    const result = resolveNotionS3ImageFromZip('images/photo.png', zipFiles);
    expect(result).toBeNull();
  });

  it('handles URL-encoded filenames', () => {
    const filesWithSpaces: File[] = [
      makeFile('My Topic/my image.png', 'png-bytes'),
    ];
    const url =
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace-id/file-id/my%20image.png?X-Amz-Expires=3600';
    const result = resolveNotionS3ImageFromZip(url, filesWithSpaces);
    expect(result).toEqual(makeFile('My Topic/my image.png', 'png-bytes'));
  });
});

describe('isNotionSignedFileUrl', () => {
  it('returns true for a prod-files-secure S3 URL carrying an X-Amz-Signature', () => {
    const url =
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/diagram.png?X-Amz-Expires=3600&X-Amz-Signature=abc';
    expect(isNotionSignedFileUrl(url)).toBe(true);
  });

  it('returns true for a file.notion.so URL carrying an expirationTimestamp', () => {
    const url =
      'https://file.notion.so/f/f/ws/file/image.png?table=block&id=xxx&expirationTimestamp=1700000000&signature=abc';
    expect(isNotionSignedFileUrl(url)).toBe(true);
  });

  it('returns true for a legacy secure.notion-static.com S3 URL with a signature', () => {
    const url =
      'https://s3.us-west-2.amazonaws.com/secure.notion-static.com/uuid/image.png?X-Amz-Signature=abc';
    expect(isNotionSignedFileUrl(url)).toBe(true);
  });

  it('returns false for the same Notion host without a signature param', () => {
    const url =
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/diagram.png';
    expect(isNotionSignedFileUrl(url)).toBe(false);
  });

  it('returns false for a non-Notion host even when signed', () => {
    const url = 'https://example.com/image.png?X-Amz-Signature=abc';
    expect(isNotionSignedFileUrl(url)).toBe(false);
  });

  it('returns false for a garbage string', () => {
    expect(isNotionSignedFileUrl('not a url at all')).toBe(false);
  });
});
