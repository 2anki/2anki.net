import { redactRequestBody } from './redactRequestBody';

const SAMPLE = 'sample-value';

describe('redactRequestBody', () => {
  it.each([
    'credential',
    'password',
    'newPassword',
    'googleDriveAuth',
    '2anki_pass_token',
    'reset_token',
    'token',
    'api_key',
    'clientSecret',
  ])('hides %s', (field) => {
    expect(redactRequestBody({ [field]: SAMPLE, deck: 'Biology' })).toEqual({
      [field]: '[redacted]',
      deck: 'Biology',
    });
  });

  it('hides a secret nested in an object or an array', () => {
    expect(
      redactRequestBody({
        settings: { credential: SAMPLE, deck: 'Biology' },
        files: [{ token: SAMPLE }],
      })
    ).toEqual({
      settings: { credential: '[redacted]', deck: 'Biology' },
      files: [{ token: '[redacted]' }],
    });
  });

  it('leaves the original body alone', () => {
    const body = { credential: SAMPLE };

    redactRequestBody(body);

    expect(body.credential).toBe(SAMPLE);
  });

  it.each([[null], [undefined], ['text'], [[1, 2]]])(
    'passes %j through',
    (body) => {
      expect(redactRequestBody(body)).toEqual(body);
    }
  );
});
