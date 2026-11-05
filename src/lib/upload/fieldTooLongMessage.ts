// The upload form sends every setting saved in the browser as a form field,
// so an over-long field on an upload is a saved setting, not something the
// person typed into the form. Chat and the contact form name theirs "message".
export function fieldTooLongMessage(field: string | undefined): string {
  if (field === 'message') {
    return 'Message is too long — shorten it and try again.';
  }
  if (field === 'user-instructions') {
    return 'Your instructions for PDF conversion in Card options are too long. Shorten them and upload again.';
  }
  return 'A setting saved in this browser is too long to send with your upload. Reset your card options to defaults and upload again.';
}
