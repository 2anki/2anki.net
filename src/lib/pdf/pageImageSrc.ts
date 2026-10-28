import path from 'node:path';

// Node writes a path to disk as UTF-8, which turns a lone surrogate (from a
// multipart filename*, a Dropbox or Drive name, an MCP filename) into U+FFFD.
// Encoding that same text keeps encodeURIComponent from throwing.
function asWrittenToDisk(segment: string): string {
  return Buffer.from(segment, 'utf8').toString('utf8');
}

// Page images are named after the upload, and the parser looks an image up
// by decodeURIComponent(src), so each path segment is encoded: the decode
// gives back the page's path as Node wrote it, and a `"` cannot end the
// attribute early.
export function toSrc(imagePath: string, workspaceLocation?: string): string {
  const segments = workspaceLocation
    ? path.relative(workspaceLocation, imagePath).split(path.sep)
    : [path.basename(imagePath)];
  return segments
    .map((segment) => encodeURIComponent(asWrittenToDisk(segment)))
    .join('/');
}
