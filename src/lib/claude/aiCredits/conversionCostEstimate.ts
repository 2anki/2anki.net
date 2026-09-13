import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { estimateConversionCostUsd, resolveModelPricing } from '../pricing';
import { countVisionTokens } from '../countVisionTokens';
import { decodeUploadImage } from '../../upload/decodeUploadImage';
import { getPageCount } from '../../pdf/getPageCount';
import { stripHtmlBoilerplate } from '../ClaudeService';
import {
  isHTMLFile,
  isImageFile,
  isMarkdownFile,
  isPDFFile,
} from '../../storage/checks';

// Per-page ceiling for a PDF's vision cost. A rendered page tops out around
// 15 vision tiles, but observed prod PDFs average far fewer; $0.03/page (input
// price from pricing.ts × ~10k tokens) is a safe ceiling that refuses runaway
// scans without blocking ordinary ones.
export const PDF_PAGE_VISION_COST_USD = 0.03;

export interface EstimateFile {
  name: string;
  contents?: Buffer | Uint8Array | string | null;
}

export interface ConversionCostEstimate {
  costUsd: number;
  // True only when at least one AI file's cost was actually estimated. A run
  // that could not be estimated must not disable the per-call guard.
  estimated: boolean;
}

export interface EstimateSettings {
  vertexAIPDFQuestions?: boolean;
  imageQuizHtmlToAnki?: boolean;
}

function toText(contents: Buffer | Uint8Array | string): string {
  return typeof contents === 'string'
    ? contents
    : Buffer.from(contents).toString('utf8');
}

function imageVisionCostUsd(buffer: Buffer): number | null {
  const decoded = decodeUploadImage(buffer);
  if (decoded == null) {
    return null;
  }
  const { tokens } = countVisionTokens({
    width: decoded.width,
    height: decoded.height,
  });
  const pricing = resolveModelPricing(null);
  return (tokens / 1_000_000) * pricing.inputPerMillion;
}

async function pdfVisionCostUsd(
  buffer: Buffer,
  workspaceLocation: string
): Promise<number | null> {
  const tmp = path.join(workspaceLocation, `ai-estimate-${randomUUID()}.pdf`);
  try {
    await fs.promises.writeFile(tmp, buffer);
    const pages = await getPageCount(tmp);
    return pages * PDF_PAGE_VISION_COST_USD;
  } catch {
    return null;
  } finally {
    await fs.promises.unlink(tmp).catch(() => undefined);
  }
}

// Estimates the AI cost of a conversion from what actually reaches Claude:
// stripped HTML/Markdown text priced by tokens, PDF pages × the vision ceiling,
// and images by their vision token count. Binary size never counts, and a file
// we cannot estimate contributes nothing and leaves `estimated` false.
export async function estimateAiConversionCostUsd(
  files: EstimateFile[],
  settings: EstimateSettings,
  workspaceLocation: string
): Promise<ConversionCostEstimate> {
  let costUsd = 0;
  let estimated = false;
  for (const file of files) {
    const contents = file.contents;
    if (contents == null) {
      continue;
    }
    if (isHTMLFile(file.name) || isMarkdownFile(file.name)) {
      const text = stripHtmlBoilerplate(toText(contents));
      costUsd += estimateConversionCostUsd(Buffer.byteLength(text));
      estimated = true;
    } else if (isPDFFile(file.name) && settings.vertexAIPDFQuestions === true) {
      const pdfCost = await pdfVisionCostUsd(
        Buffer.from(contents as Buffer),
        workspaceLocation
      );
      if (pdfCost != null) {
        costUsd += pdfCost;
        estimated = true;
      }
    } else if (
      isImageFile(file.name) &&
      settings.imageQuizHtmlToAnki === true
    ) {
      const imageCost = imageVisionCostUsd(Buffer.from(contents as Buffer));
      if (imageCost != null) {
        costUsd += imageCost;
        estimated = true;
      }
    }
  }
  return { costUsd, estimated };
}
