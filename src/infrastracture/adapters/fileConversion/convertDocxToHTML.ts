import mammoth from 'mammoth';

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

type MammothOptions = Parameters<typeof mammoth.convertToHtml>[1];

function buildImgElementConverter(mediaSink: DocxImageMediaSink) {
  return mammoth.images.imgElement(async (image) => {
    const bytes = await image.readAsBuffer();
    const fileName = mediaSink.write(bytes, image.contentType);
    return { src: fileName };
  });
}

async function convertBody(
  contents: Buffer,
  options: MammothOptions
): Promise<string> {
  const chunks = splitDocxBody(contents, DOCX_BODY_CHUNK_BYTES);
  if (chunks == null) {
    return (await mammoth.convertToHtml({ buffer: contents }, options)).value;
  }
  const htmlChunks: string[] = [];
  for (let index = 0; index < chunks.count; index++) {
    const result = await mammoth.convertToHtml(
      { buffer: chunks.docxAt(index) },
      options
    );
    htmlChunks.push(result.value);
  }
  console.info('[convertDocxToHTML] converted a long document in pieces', {
    pieces: chunks.count,
  });
  return joinDocxChunkHtml(htmlChunks);
}

export async function convertDocxToHTML(
  contents: Buffer,
  mediaSink?: DocxImageMediaSink,
  preprocessOptions: PreprocessDocxOptions = {}
): Promise<string> {
  let html;
  try {
    const options = mediaSink
      ? {
          styleMap: STRIKETHROUGH_TO_TAG_STYLE_MAP,
          convertImage: buildImgElementConverter(mediaSink),
        }
      : { styleMap: STRIKETHROUGH_TO_TAG_STYLE_MAP };
    html = await convertBody(contents, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`docx_parse_failed: ${msg}`);
  }
  try {
    return preprocessDocxHTML(html, preprocessOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`docx_parse_failed: ${msg}`);
  }
}
