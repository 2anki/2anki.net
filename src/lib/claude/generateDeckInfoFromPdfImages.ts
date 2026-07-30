import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { ANKI_MATH_FRAGMENT } from './ankiMathFragment';
import { VisionMediaType } from './countVisionTokens';
import {
  DeckInfo,
  EMPTY_CONTENT_USER_MESSAGE,
  PdfImageFallbackContext,
  expandCompactDeckInfo,
  getAnthropicClient,
  mergeDeckInfoArrays,
  parseDeckResponse,
} from './ClaudeService';

type CompactDeck = ReturnType<typeof parseDeckResponse>[number];

const PDF_PAGE_VISION_MAX_TOKENS = 8192;
const PDF_PAGE_VISION_RETRY_MAX_TOKENS = 16384;
const PDF_PAGE_VISION_CONCURRENCY = 4;

const MEDIA_TYPE_BY_EXT: Record<string, VisionMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function buildPdfPageVisionPrompt(userInstructions?: string): string {
  const extra = userInstructions?.trim()
    ? `\n\nAdditional instructions:\n${userInstructions.trim()}`
    : '';
  return `This image is one page of a study document whose text layer could not be extracted. Read the page and extract Anki flashcards from everything on it.

Output ONLY a compact JSON array. Format (nothing else — no markdown, no explanation):
[{"deck":"Deck Name","cards":[{"q":"front text","a":"back text","tags":["topic_tag"]}]}]

Rules:
- Each card tests one atomic fact, definition, or concept
- Q is the question or term, A is the answer or definition
- Work through the entire page — every heading, term, definition, table row, and list item is a card candidate
- Preserve important formatting but keep cards concise
- Use the page's title or subject as the deck name if one is visible
- Add 1–3 short lowercase snake_case topic tags per card, drawn from the actual content
- Never invent content — only use what is legible on the page
- If the page holds no readable study content, return an empty array []${extra}

${ANKI_MATH_FRAGMENT}`;
}

interface ResolvedPageImage {
  data: string;
  mediaType: VisionMediaType;
  relPath: string;
}

function isRemoteOrInlineSrc(src: string): boolean {
  return (
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('data:')
  );
}

function resolvePageImages(
  html: string,
  mediaBaseDir: string
): ResolvedPageImage[] {
  const $ = cheerio.load(html);
  const baseDir = path.resolve(mediaBaseDir);
  const images: ResolvedPageImage[] = [];
  const seen = new Set<string>();

  $('img[src]').each((_, el) => {
    const rawSrc = $(el).attr('src') ?? '';
    if (!rawSrc || isRemoteOrInlineSrc(rawSrc)) return;

    const decoded = decodeURIComponent(rawSrc);
    const resolved = path.resolve(baseDir, decoded);
    if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
      return;
    }
    if (seen.has(resolved)) return;
    seen.add(resolved);

    const mediaType = MEDIA_TYPE_BY_EXT[path.extname(resolved).toLowerCase()];
    if (!mediaType) return;

    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(resolved);
    } catch {
      return;
    }
    const relPath = path.relative(baseDir, resolved).replaceAll('\\', '/');
    images.push({ data: bytes.toString('base64'), mediaType, relPath });
  });

  return images;
}

export function attachPageImageToCompactDecks(
  decks: CompactDeck[],
  relPath: string
): CompactDeck[] {
  const imageTag = `<br><img src="${relPath}" style="max-width:100%;max-height:320px;height:auto;">`;
  return decks.map((deck) => ({
    ...deck,
    cards: deck.cards.map((card) => ({
      ...card,
      media: [relPath],
      a: `${card.a ?? ''}${imageTag}`,
    })),
  }));
}

async function visionCardsForPage(
  image: ResolvedPageImage,
  prompt: string,
  pageIndex: number
): Promise<CompactDeck[]> {
  const client = getAnthropicClient();

  const callVision = (maxTokens: number) =>
    client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType,
                data: image.data,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

  let response = await callVision(PDF_PAGE_VISION_MAX_TOKENS);
  if (response.stop_reason === 'max_tokens') {
    console.warn('[Claude] PDF page vision truncated, retrying', {
      pageIndex,
      maxTokens: PDF_PAGE_VISION_MAX_TOKENS,
      retryMaxTokens: PDF_PAGE_VISION_RETRY_MAX_TOKENS,
    });
    response = await callVision(PDF_PAGE_VISION_RETRY_MAX_TOKENS);
  }

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return parseDeckResponse(cleaned, raw, pageIndex);
  } catch (err) {
    console.warn('[Claude] PDF page vision parse failed; skipping page', {
      pageIndex,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function runPagesWithConcurrency(
  images: ResolvedPageImage[],
  prompt: string,
  attachPageImages: boolean,
  onProgress?: (step: string) => void
): Promise<CompactDeck[]> {
  const compactDecks: CompactDeck[] = [];
  const failures: unknown[] = [];
  let cursor = 0;

  // A page that fails terminally used to reject its worker, which rejected the
  // whole Promise.all and discarded every page already converted — while the
  // remaining workers kept paying for pages the caller would never see. Each
  // page now stands on its own; the caller decides what to do with a total loss.
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= images.length) return;
      onProgress?.(`claude:vision:page:${index + 1}:${images.length}`);
      try {
        const decks = await visionCardsForPage(images[index], prompt, index);
        const attributed = attachPageImages
          ? attachPageImageToCompactDecks(decks, images[index].relPath)
          : decks;
        compactDecks.push(...attributed);
      } catch (err) {
        failures.push(err);
        console.warn('[Claude] PDF page vision failed; keeping other pages', {
          pageIndex: index,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const workerCount = Math.min(PDF_PAGE_VISION_CONCURRENCY, images.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failures.length === images.length && failures.length > 0) {
    throw failures[0];
  }
  if (failures.length > 0) {
    console.warn('[Claude] PDF image fallback: some pages failed', {
      failedPages: failures.length,
      pageCount: images.length,
    });
  }
  return compactDecks;
}

export async function generateDeckInfoFromPdfImages(
  htmlContent: string,
  context: PdfImageFallbackContext,
  userInstructions?: string,
  onProgress?: (step: string) => void
): Promise<DeckInfo[]> {
  const t0 = Date.now();
  const images = resolvePageImages(htmlContent, context.mediaBaseDir);

  if (images.length === 0) {
    console.warn('[Claude] PDF image fallback: no resolvable page images', {
      mediaBaseDir: context.mediaBaseDir,
    });
    throw new Error(EMPTY_CONTENT_USER_MESSAGE);
  }

  console.log('[Claude] PDF image fallback: routing pages to vision', {
    pageCount: images.length,
  });

  const attachPageImages = context.attachPageImages ?? true;
  const prompt = buildPdfPageVisionPrompt(userInstructions);
  const compactDecks = await runPagesWithConcurrency(
    images,
    prompt,
    attachPageImages,
    onProgress
  );
  const deckInfo = mergeDeckInfoArrays(
    expandCompactDeckInfo(
      compactDecks,
      images.map((i) => i.relPath),
      null
    )
  );
  const totalCards = deckInfo.reduce((sum, d) => sum + d.cards.length, 0);

  console.log('[Claude] PDF image fallback: vision done', {
    pageCount: images.length,
    totalDecks: deckInfo.length,
    totalCards,
    totalMs: Date.now() - t0,
  });

  if (totalCards === 0) {
    throw new Error(EMPTY_CONTENT_USER_MESSAGE);
  }

  return deckInfo;
}
