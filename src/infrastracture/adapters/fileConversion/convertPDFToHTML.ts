import { getAnthropicClient } from '../../../lib/claude/ClaudeService';
import { convertWithClaude } from './claudeFileConversion';

const SYSTEM_INSTRUCTIONS = `
Create an HTML file with questions and answers formatted as follows:
1. For each question and answer, use a <ul> tag with the CSS class <<<toggle>>>
2. Inside this <ul>, include a <li> tag with the details
3. The <details> tag should contain a <summary> tag for the question and the remaining lines for the answer
4. Use the same style as Notion for the HTML
5. Preserve all original formatting and structure from the PDF
6. Maintain proper HTML syntax and nesting
7. Ensure each question-answer pair is properly closed and formatted

Technical requirements:
- Each question-answer pair must be in its own <ul> element
- The CSS class <<<toggle>>> must be preserved exactly as shown
- The HTML structure must match Notion's toggle block format
- All content must be properly escaped for HTML
- Maintain proper indentation and formatting
`;

const DEFAULT_PDF_TO_HTML_INSTRUCTIONS = `
Some extra rules and explanations:
- Read the document from start to finish and identify any question and answers.
- Use the same language as the document or infer the language based on what is mostly used.
- Use the same text as in the document and do not make up any questions or answers.
- Cite the document as source for the text.
- Be complete by finding all of the questions and answer in the document.
- Do not limit the number of number of questions and answer but create all of them!
- Do not make up any questions and use the questions in the document!
- Create a ul for every question pair, not one ul for all of them with li!
`;

export const convertPDFToHTML = (
  pdf: string,
  userInstructions?: string,
  userId?: number | null
): Promise<string> => {
  const client = getAnthropicClient();
  const instructions = userInstructions ?? DEFAULT_PDF_TO_HTML_INSTRUCTIONS;

  return convertWithClaude(
    client,
    SYSTEM_INSTRUCTIONS,
    [
      { type: 'text', text: instructions },
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: pdf,
        },
      },
    ],
    { pdf: true, userId }
  );
};

export const getDefaultUserInstructions = (): string => {
  return DEFAULT_PDF_TO_HTML_INSTRUCTIONS;
};
