import { redactRequestBody } from './redactRequestBody';

describe('redactRequestBody', () => {
  it.each(['credential', 'password'])('hides %s', (field) => {
    expect(redactRequestBody({ [field]: 'hunter2', deck: 'Biology' })).toEqual({
      [field]: '[redacted]',
      deck: 'Biology',
    });
  });

  it('leaves the original body alone', () => {
    const body = { credential: 'hunter2' };

    redactRequestBody(body);

    expect(body.credential).toBe('hunter2');
  });

  it.each([[null], [undefined], ['text'], [[1, 2]]])(
    'passes %j through',
    (body) => {
      expect(redactRequestBody(body)).toEqual(body);
    }
  );
});
