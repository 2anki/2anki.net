import type Anthropic from '@anthropic-ai/sdk';

export interface ChatAttachment {
  mimeType: string;
  data: Buffer;
  fileName?: string;
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

function isImageMime(mime: string): mime is ImageMediaType {
  return IMAGE_MIMES.has(mime);
}

const PDF_MIME = 'application/pdf';

export function isReplayableAttachmentMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime) || mime === PDF_MIME;
}

export function buildAttachmentBlocks(
  attachments: ChatAttachment[]
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const attachment of attachments) {
    const data = attachment.data.toString('base64');

    if (isImageMime(attachment.mimeType)) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: attachment.mimeType, data },
      });
    } else if (attachment.mimeType === PDF_MIME) {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: PDF_MIME, data },
      });
    }
  }
  return blocks;
}
