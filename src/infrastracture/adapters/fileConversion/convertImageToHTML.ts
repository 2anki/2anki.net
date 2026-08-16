import { getAnthropicClient } from '../../../lib/claude/ClaudeService';
import { detectFileMime } from '../../../lib/detectFileMime';
import { convertWithClaude } from './claudeFileConversion';

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set<ImageMediaType>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

function isSupportedImageMediaType(value: string): value is ImageMediaType {
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(value as ImageMediaType);
}

export function detectImageMediaType(imageData: string): ImageMediaType {
  const header = Buffer.from(imageData.slice(0, 24), 'base64');
  const sniffed = detectFileMime(header);
  if (sniffed != null && isSupportedImageMediaType(sniffed)) {
    return sniffed;
  }
  return 'image/png';
}

const IMAGE_TO_HTML_SYSTEM_PROMPT = `Convert the text in this image to the following format for (every question is their own ul):

        <ul class="toggle">
          <li>
           <details>
            <summary>
                n) question
            </summary>
        <p>A) ..., </p>
        <p>B)... </p>
        etc.
        <p>and finally Answer: D</p>
           </details>
          </li>
          </ul>

        —
        - Extra rules: n=is the number for the question, question=the question text
    - Add newline between the options
    - If you are not able to detect the pattern above, try converting this into a question and answer format`;

export function removeFirstAndLastLine(content: string): string {
  const lines = content.split('\n');
  return lines.slice(1, -1).join('\n');
}

export const convertImageToHTML = async (
  imageData: string,
  userId?: number | null
): Promise<string> => {
  const client = getAnthropicClient();
  const htmlContent = await convertWithClaude(
    client,
    IMAGE_TO_HTML_SYSTEM_PROMPT,
    [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: detectImageMediaType(imageData),
          data: imageData,
        },
      },
    ],
    { userId }
  );
  return removeFirstAndLastLine(htmlContent);
};
