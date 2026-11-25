import mammoth from 'mammoth';

import { convertDocxToHTML } from './convertDocxToHTML';
import {
  preprocessDocxHTML,
  PreprocessDocxOptions,
} from './preprocessDocxHTML';
import { DocxImageMediaSink } from './docxImageMediaSink';
import {
  DOCX_BODY_CHUNK_BYTES,
  joinDocxChunkHtml,
  splitDocxBody,
} from './docxBodyChunks';

const STRIKETHROUGH_TO_TAG_STYLE_MAP = ['strike => del'];

function mammothOptions(mediaSink: DocxImageMediaSink) {
  return {
    styleMap: STRIKETHROUGH_TO_TAG_STYLE_MAP,
    convertImage: mammoth.images.imgElement(async (image) => {
      const bytes = await image.readAsBuffer();
      return { src: mediaSink.write(bytes, image.contentType) };
    }),
  };
}

// The conversion worker's Word path. A body long enough to run the worker out
// of heap converts in pieces; everything else, and every file the splitter
// declines, goes through convertDocxToHTML exactly as before. The web-process
// callers (upload census, chat attachments) keep calling convertDocxToHTML.
export async function convertLongDocxToHTML(
  contents: Buffer,
  mediaSink: DocxImageMediaSink,
  preprocessOptions: PreprocessDocxOptions = {}
): Promise<string> {
  const chunks = splitDocxBody(contents, DOCX_BODY_CHUNK_BYTES);
  if (chunks == null) {
    return convertDocxToHTML(contents, mediaSink, preprocessOptions);
  }
  const options = mammothOptions(mediaSink);
  const htmlChunks: string[] = [];
  try {
    for (let index = 0; index < chunks.count; index++) {
      const result = await mammoth.convertToHtml(
        { buffer: chunks.docxAt(index) },
        options
      );
      htmlChunks.push(result.value);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`docx_parse_failed: ${msg}`);
  }
  console.info('[convertLongDocxToHTML] converted a long document in pieces', {
    pieces: chunks.count,
  });
  try {
    return preprocessDocxHTML(joinDocxChunkHtml(htmlChunks), preprocessOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`docx_parse_failed: ${msg}`);
  }
}
