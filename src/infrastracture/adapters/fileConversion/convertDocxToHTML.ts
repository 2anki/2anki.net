import mammoth from 'mammoth';

import {
  preprocessDocxHTML,
  PreprocessDocxOptions,
} from './preprocessDocxHTML';
import { DocxImageMediaSink } from './docxImageMediaSink';

const STRIKETHROUGH_TO_TAG_STYLE_MAP = ['strike => del'];

function buildImgElementConverter(mediaSink: DocxImageMediaSink) {
  return mammoth.images.imgElement(async (image) => {
    const bytes = await image.readAsBuffer();
    const fileName = mediaSink.write(bytes, image.contentType);
    return { src: fileName };
  });
}

export async function convertDocxToHTML(
  contents: Buffer,
  mediaSink?: DocxImageMediaSink,
  preprocessOptions: PreprocessDocxOptions = {}
): Promise<string> {
  let result;
  try {
    const options = mediaSink
      ? {
          styleMap: STRIKETHROUGH_TO_TAG_STYLE_MAP,
          convertImage: buildImgElementConverter(mediaSink),
        }
      : { styleMap: STRIKETHROUGH_TO_TAG_STYLE_MAP };
    result = await mammoth.convertToHtml({ buffer: contents }, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`docx_parse_failed: ${msg}`);
  }
  try {
    return preprocessDocxHTML(result.value, preprocessOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`docx_parse_failed: ${msg}`);
  }
}
