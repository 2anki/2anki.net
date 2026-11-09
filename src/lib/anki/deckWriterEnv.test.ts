import { deckWriterEnv } from './deckWriterEnv';

describe('deckWriterEnv', () => {
  it('passes the reference to the deck writer beside the inherited environment', () => {
    const env = deckWriterEnv('job-42');

    expect(env?.TWOANKI_REQUEST_ID).toBe('job-42');
    expect(env?.PATH).toBe(process.env.PATH);
  });

  it.each([undefined, ''])(
    'leaves the environment inherited when there is no reference (%s)',
    (reference) => {
      expect(deckWriterEnv(reference)).toBeUndefined();
    }
  );
});
