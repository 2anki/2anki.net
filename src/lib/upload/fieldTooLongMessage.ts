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
