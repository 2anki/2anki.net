import { isValidAudioFile } from './format';

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
