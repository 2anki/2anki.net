import {
  formFieldTooLongMessage,
  uploadFieldTooLongBody,
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
    [
      'deckName',
      'Your saved deck name is too long. Shorten it under Deck name in Settings, then upload again.',
    ],
    ['template', SAVED_SETTING],
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

describe('uploadFieldTooLongBody', () => {
  it.each([
    ['user-instructions', { setting: 'user_instructions' }],
    ['deckName', { setting: 'deck_name' }],
    ['template', {}],
    [undefined, {}],
  ])('answers %s with the setting it names', (field, setting) => {
    expect(uploadFieldTooLongBody(field)).toEqual({
      code: 'setting_too_long',
      message: uploadFieldTooLongMessage(field),
      ...setting,
    });
  });
});
