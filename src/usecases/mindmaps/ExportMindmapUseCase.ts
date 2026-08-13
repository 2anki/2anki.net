import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import StorageHandler from '../../lib/storage/StorageHandler';
import { MindmapRepositoryInterface } from '../../data_layer/MindmapRepository';
import { MindmapsId } from '../../data_layer/public/Mindmaps';
import { UsersId } from '../../data_layer/public/Users';
import { mindmapToNotes } from './mindmapToNotes';
import { mindmapToClozeNotes } from './mindmapToClozeNotes';
import { mindmapToMarkmapHtml } from './mindmapToMarkmapHtml';
import { collectMindmapImages } from './collectMindmapImages';
import { countExcludedMindmapNodes } from './mindmapExportCensus';
import { MindmapData } from './MindmapData';
import { buildMindmapDeckInfo } from './buildMindmapDeckInfo';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import Note from '../../lib/parser/Note';

export class MindmapNotFoundError extends Error {
  constructor() {
    super('Mind map not found');
    this.name = 'MindmapNotFoundError';
  }
}

export type MindmapCardType = 'basic' | 'cloze' | 'markmap';

interface ExportInput {
  id: MindmapsId;
  userId: UsersId;
  deckName?: string;
  cardType?: MindmapCardType;
}

export interface ExportMindmapResult {
  buffer: Buffer;
  excludedNodeCount: number;
}

export class ExportMindmapUseCase {
  constructor(
    private readonly repo: MindmapRepositoryInterface,
    private readonly storage: StorageHandler
  ) {}

  private buildNotes(
    data: MindmapData,
    deckName: string,
    cardType: MindmapCardType,
    filenameMap: Record<string, string>,
    allMediaFilenames: string[]
  ): Note[] {
    if (cardType === 'markmap') {
      const html = mindmapToMarkmapHtml(data, deckName, filenameMap);
      const note = new Note(deckName, html);
      if (allMediaFilenames.length > 0) note.media = allMediaFilenames;
      return [note];
    }
    if (cardType === 'basic') {
      return mindmapToNotes(data, filenameMap);
    }
    return mindmapToClozeNotes(data, filenameMap);
  }

  async execute(input: ExportInput): Promise<ExportMindmapResult> {
    const { id, userId, deckName, cardType = 'basic' } = input;
    const map = await this.repo.findById(id, userId);
    if (map == null) {
      throw new MindmapNotFoundError();
    }

    const resolvedDeckName = deckName ?? map.title;
    const mapData = map.data as MindmapData;
    const excludedNodeCount = countExcludedMindmapNodes(mapData, cardType);
    const collectedImages = await collectMindmapImages(mapData, this.storage);

    const filenameMap: Record<string, string> = {};
    const allMediaFilenames: string[] = [];
    for (const img of collectedImages) {
      filenameMap[img.filename] = img.filename;
      allMediaFilenames.push(img.filename);
    }

    const notes = this.buildNotes(
      mapData,
      resolvedDeckName,
      cardType,
      filenameMap,
      allMediaFilenames
    );

    const workspaceDir = path.join(
      os.tmpdir(),
      `mindmap-export-${randomUUID()}`
    );
    fs.mkdirSync(workspaceDir, { recursive: true });

    try {
      const deckInfo = buildMindmapDeckInfo(resolvedDeckName, notes);

      const exporter = new CustomExporter(resolvedDeckName, workspaceDir);
      exporter.configure(deckInfo as never);

      for (const img of collectedImages) {
        exporter.addMedia(img.filename, img.buffer);
      }

      const buffer = await exporter.save();
      return { buffer, excludedNodeCount };
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  }
}
