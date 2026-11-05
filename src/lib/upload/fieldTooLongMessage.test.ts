import {
  formFieldTooLongMessage,
  uploadFieldTooLongMessage,
} from './fieldTooLongMessage';

const SAVED_SETTING =
  'A setting saved in this browser is too long to send with your upload. Open Settings, choose Reset to defaults, and upload again.';
const MESSAGE = 'Message is too long — shorten it and try again.';
const FORM = 'Part of this form is too long to send. Shorten it and try again.';

describe('uploadFieldTooLongMessage', () => {
  it.each([
    [
      'user-instructions',
      'Your user instructions for PDF conversion are too long. Shorten them under PDF & AI in Settings, then upload again.',
    ],
    ['deckName', SAVED_SETTING],
    [undefined, SAVED_SETTING],
  ])('names the %s field', (field, message) => {
    expect(uploadFieldTooLongMessage(field)).toBe(message);
  });
});

describe('formFieldTooLongMessage', () => {
  it.each([
    ['content', MESSAGE],
    ['history', MESSAGE],
    ['message', MESSAGE],
    ['data', FORM],
    [undefined, FORM],
  ])('names the %s field', (field, message) => {
    expect(formFieldTooLongMessage(field)).toBe(message);
  });
});
