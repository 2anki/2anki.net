import type {
  TooLongSetting,
  UploadErrorBody,
} from '../../types/UploadErrorBody';

const TOO_LONG_SETTINGS = new Map<string, TooLongSetting>([
  ['user-instructions', 'user_instructions'],
  ['deckName', 'deck_name'],
]);

// The 413 body for an over-long field on an upload: a code the web translates,
// the setting when it has its own place in Settings, and the English sentence.
export function uploadFieldTooLongBody(
  field: string | undefined
): UploadErrorBody {
  const setting = field == null ? undefined : TOO_LONG_SETTINGS.get(field);
  return {
    code: 'setting_too_long',
    message: uploadFieldTooLongMessage(field),
    ...(setting == null ? {} : { setting }),
  };
}

// The upload form sends the card settings saved in the browser as form
// fields, so an over-long field on an upload is a saved setting, not something
// the person typed into the form.
export function uploadFieldTooLongMessage(field: string | undefined): string {
  if (field === 'user-instructions') {
    return 'Your user instructions for PDF conversion are too long. Shorten them under PDF & AI in Settings, then upload again.';
  }
  if (field === 'deckName') {
    return 'Your saved deck name is too long. Shorten it under Deck name in Settings, then upload again.';
  }
  return 'A setting saved in this browser is too long to send with your upload. Open Settings, choose Reset to defaults, and upload again.';
}

// Every other multer route: chat posts `content` and `history`, the contact
// form `message`.
export function formFieldTooLongMessage(field: string | undefined): string {
  if (field === 'content' || field === 'history' || field === 'message') {
    return 'Message is too long — shorten it and try again.';
  }
  return 'Part of this form is too long to send. Shorten it and try again.';
}
