import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import {
  PhotoToFlashcardsUseCase,
  DEFAULT_PHOTO_DENSITY,
  DEFAULT_PHOTO_MODE,
  DEFAULT_PHOTO_CARD_STYLE,
  type PhotoDensity,
  type PhotoMode,
  type PhotoCardStyle,
} from '../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import type { VisionMediaType } from '../lib/claude/countVisionTokens';
import { buildContentDisposition } from '../lib/buildContentDisposition';
import { detectFileMime } from '../lib/detectFileMime';
import { isPaying } from '../lib/isPaying';

const ALLOWED_MEDIA_TYPES: VisionMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];
const ALLOWED_DENSITIES: PhotoDensity[] = ['sparse', 'balanced', 'dense'];
const ALLOWED_MODES: PhotoMode[] = ['generative', 'verbatim'];
const ALLOWED_CARD_STYLES: PhotoCardStyle[] = ['generative', 'heading-driven'];

interface RawPhotoBody {
  imageBase64?: unknown;
  mediaType?: unknown;
  deckName?: unknown;
  width?: unknown;
  height?: unknown;
  includeSourceImage?: unknown;
  density?: unknown;
  mode?: unknown;
  cardStyle?: unknown;
  mcqEnabled?: unknown;
}

function isAllowedMediaType(value: unknown): value is VisionMediaType {
  return (
    typeof value === 'string' &&
    (ALLOWED_MEDIA_TYPES as string[]).includes(value)
  );
}

function parseDensity(value: unknown): PhotoDensity {
  return typeof value === 'string' &&
    (ALLOWED_DENSITIES as string[]).includes(value)
    ? (value as PhotoDensity)
    : DEFAULT_PHOTO_DENSITY;
}

function parseMode(value: unknown): PhotoMode {
  return typeof value === 'string' &&
    (ALLOWED_MODES as string[]).includes(value)
    ? (value as PhotoMode)
    : DEFAULT_PHOTO_MODE;
}

function parseCardStyle(value: unknown): PhotoCardStyle {
  return typeof value === 'string' &&
    (ALLOWED_CARD_STYLES as string[]).includes(value)
    ? (value as PhotoCardStyle)
    : DEFAULT_PHOTO_CARD_STYLE;
}

export class PhotoToFlashcardsController {
  constructor(private readonly useCase: PhotoToFlashcardsUseCase) {}

  async create(req: express.Request, res: express.Response): Promise<void> {
    const body = req.body as RawPhotoBody;

    const imageBase64 =
      typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
    if (imageBase64.length === 0) {
      res.status(400).json({ message: 'imageBase64 is required' });
      return;
    }

    // Trust the bytes, not the client-declared type: a JPEG uploaded as
    // image/png makes Anthropic reject the message with a media_type mismatch.
    const detectedMediaType = detectFileMime(
      Buffer.from(imageBase64.slice(0, 64), 'base64')
    );
    const mediaType = isAllowedMediaType(detectedMediaType)
      ? detectedMediaType
      : body.mediaType;
    if (!isAllowedMediaType(mediaType)) {
      res.status(400).json({
        message: `Unsupported image type. Use ${ALLOWED_MEDIA_TYPES.join(', ')}.`,
      });
      return;
    }
    const deckName =
      typeof body.deckName === 'string' && body.deckName.trim()
        ? body.deckName.trim()
        : 'Photo deck';

    const width = typeof body.width === 'number' ? body.width : 512;
    const height = typeof body.height === 'number' ? body.height : 512;

    const owner = (res.locals['owner'] ?? '') as string;
    const paying = isPaying(res.locals);
    const includeSourceImage =
      typeof body.includeSourceImage === 'boolean'
        ? body.includeSourceImage
        : true;

    const mode = parseMode(body.mode);
    const cardStyle = parseCardStyle(body.cardStyle);
    const mcqEnabled = body.mcqEnabled === true;

    let result: Awaited<ReturnType<PhotoToFlashcardsUseCase['execute']>>;
    try {
      result = await this.useCase.execute({
        imageBase64,
        mediaType,
        deckName,
        owner,
        isPaying: paying,
        imageDimensions: { width, height },
        includeSourceImage,
        density: parseDensity(body.density),
        mode,
        cardStyle,
        mcqEnabled,
      });
    } catch (err) {
      const e = err as Error & {
        status?: number;
        used?: number;
        limit?: number;
        code?: string;
      };
      if (e.status === 403) {
        res.status(403).json({ message: e.message });
        return;
      }
      if (e.status === 413) {
        res.status(413).json({ message: e.message });
        return;
      }
      if (e.status === 422) {
        res.status(422).json({ message: e.message, code: e.code });
        return;
      }
      if (e.status === 429) {
        res.status(429).json({
          message: e.message,
          used: e.used,
          limit: e.limit,
        });
        return;
      }
      throw err;
    }

    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(path.basename(result.apkgPath))
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Card-Count', String(result.cardCount));
    res.setHeader('X-MCQ-Count', String(result.mcqCount));
    res.setHeader('X-MCQ-Skipped-Count', String(result.mcqSkippedCount));

    const stream = fs.createReadStream(result.apkgPath);
    stream.on('end', () => fs.unlink(result.apkgPath, () => undefined));
    stream.pipe(res);
  }
}
