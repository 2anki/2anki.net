import { fieldTooLongMessage } from './fieldTooLongMessage';

describe('fieldTooLongMessage', () => {
  it.each([
    ['message', 'Message is too long — shorten it and try again.'],
    [
      'user-instructions',
      'Your instructions for PDF conversion in Card options are too long. Shorten them and upload again.',
    ],
    [
      'deck-name',
      'A setting saved in this browser is too long to send with your upload. Reset your card options to defaults and upload again.',
    ],
    [
      undefined,
      'A setting saved in this browser is too long to send with your upload. Reset your card options to defaults and upload again.',
    ],
  ])('names the %s field', (field, message) => {
    expect(fieldTooLongMessage(field)).toBe(message);
  });
});
