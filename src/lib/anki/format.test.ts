import { audioFileExtensionFromUrl, isValidAudioFile } from './format';

describe('isValidAudioFile', () => {
  it.each([
    'recording.mp3',
    'voice memo.m4a',
    'lecture.wav',
    'note.ogg',
    'note.oga',
    'clip.opus',
    'song.flac',
    'stream.aac',
    'browser-recording.webm',
    'UPPER.MP3',
    'Nested/Dir/audio.M4A',
  ])('accepts %s', (name) => {
    expect(isValidAudioFile(name)).toBe(true);
  });

  it.each([
    'document.pdf',
    'image.png',
    'video.mp4',
    'archive.zip',
    'page.html',
    'mp3', // no dot — the suffix alone is not a file
    'audio.mp3.txt',
  ])('rejects %s', (name) => {
    expect(isValidAudioFile(name)).toBe(false);
  });
});

describe('audioFileExtensionFromUrl', () => {
  it.each([
    ['https://example.com/voice-memo.m4a', '.m4a'],
    ['https://example.com/clip.webm', '.webm'],
    ['https://example.com/UPPER.MP3', '.MP3'],
    [
      'https://prod-files.notion.so/clip.ogg?X-Amz-Algorithm=AWS4-HMAC-SHA256',
      '.ogg',
    ],
  ])('keeps the allowlisted extension in %s', (url, expected) => {
    expect(audioFileExtensionFromUrl(url)).toBe(expected);
  });

  it('maps an mp4 audio container to m4a', () => {
    expect(audioFileExtensionFromUrl('https://example.com/clip.mp4')).toBe(
      '.m4a'
    );
  });

  it.each([
    'https://example.com/attachment/download',
    'https://example.com/photo.png',
    'https://example.com/clip.mp3.exe',
  ])('falls back to mp3 for %s', (url) => {
    expect(audioFileExtensionFromUrl(url)).toBe('.mp3');
  });
});
