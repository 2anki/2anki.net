import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  CreateImageOcclusionDeckUseCase,
  ImageOcclusionImage,
  OcclusionRect,
} from '../usecases/imageOcclusion/CreateImageOcclusionDeckUseCase';
import { HttpCodedError } from '../lib/errors/HttpCodedError';
import { buildContentDisposition } from '../lib/buildContentDisposition';

interface RawPoint {
  x: unknown;
  y: unknown;
}
interface RawRect {
  x: unknown;
  y: unknown;
  w: unknown;
  h: unknown;
  label?: unknown;
  shape?: unknown;
  points?: unknown;
  groupId?: unknown;
}
interface RawImageEntry {
  imageName?: unknown;
  header?: unknown;
  rects?: unknown;
  s3Key?: unknown;
}
interface RawData {
  deckName?: unknown;
  mode?: unknown;
  images?: unknown;
}

function parseRect(r: RawRect): OcclusionRect {
  const base: OcclusionRect = {
    x: Number(r.x),
    y: Number(r.y),
    w: Number(r.w),
    h: Number(r.h),
    label: typeof r.label === 'string' ? r.label : '',
  };
  if (r.shape === 'ellipse' || r.shape === 'polygon' || r.shape === 'rect') {
    base.shape = r.shape;
  }
  if (r.shape === 'polygon' && Array.isArray(r.points)) {
    base.points = (r.points as RawPoint[]).map((p) => ({
      x: Number(p.x),
      y: Number(p.y),
    }));
  }
  if (typeof r.groupId === 'string' && r.groupId.length > 0) {
    base.groupId = r.groupId;
  }
  return base;
}
function parseImageEntry(e: RawImageEntry): ImageOcclusionImage {
  return {
    imageName: typeof e.imageName === 'string' ? e.imageName : '',
    header: typeof e.header === 'string' ? e.header : '',
    rects: Array.isArray(e.rects) ? (e.rects as RawRect[]).map(parseRect) : [],
    s3Key: typeof e.s3Key === 'string' ? e.s3Key : undefined,
  };
}

class ImageOcclusionController {
  constructor(private readonly useCase: CreateImageOcclusionDeckUseCase) {}

  async create(req: express.Request, res: express.Response): Promise<void> {
    let rawData: RawData;
    try {
      rawData = JSON.parse(
        typeof req.body?.data === 'string' ? req.body.data : '{}'
      ) as RawData;
    } catch {
      res.status(400).json({ message: 'Invalid JSON in data field.' });
      return;
    }
    const deckName =
      typeof rawData.deckName === 'string' && rawData.deckName.trim()
        ? rawData.deckName.trim()
        : 'Image Occlusion';
    const mode = rawData.mode === 'hide_one' ? 'hide_one' : 'hide_all';
    const images: ImageOcclusionImage[] = Array.isArray(rawData.images)
      ? (rawData.images as RawImageEntry[]).map(parseImageEntry)
      : [];
    if (images.length === 0) {
      res.status(400).json({ message: 'At least one image is required.' });
      return;
    }
    const uploadedFiles =
      (req.files as Express.Multer.File[] | undefined) ?? [];
    const imageFiles = uploadedFiles.map((f) => ({
      name: f.originalname,
      path: f.path,
    }));
    const isPaying =
      res.locals['patreon'] === true || res.locals['subscriber'] === true;
    let apkgPath: string;
    try {
      apkgPath = await this.useCase.execute({
        deckName,
        mode,
        images,
        imageFiles,
        isPaying,
      });
    } catch (err) {
      if (err instanceof HttpCodedError) {
        res.status(err.status).json({ code: err.code, message: err.message });
        return;
      }
      throw err;
    } finally {
      for (const f of uploadedFiles) fs.unlink(f.path, () => undefined);
    }
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(path.basename(apkgPath))
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    const stream = fs.createReadStream(apkgPath);
    stream.on('end', () => {
      fs.unlink(apkgPath, () => undefined);
    });
    stream.pipe(res);
  }
}

export default ImageOcclusionController;
