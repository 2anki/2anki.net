import fs from 'node:fs';

import { parseOpml } from '../../lib/parser/parsers/parseOpml';
import { parseBrainstormsJson } from '../../lib/parser/parsers/parseBrainstormsJson';
import { mindmapToNotes } from '../mindmaps/mindmapToNotes';
import { MindmapData } from '../mindmaps/MindmapData';
import { buildMindmapDeckInfo } from '../mindmaps/buildMindmapDeckInfo';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import { isOpmlFile, isBrainstormsJsonFile } from '../../lib/storage/checks';
import getDeckFilename from '../../lib/anki/getDeckFilename';

function parseMindmapFile(filename: string, content: string): MindmapData {
  if (isOpmlFile(filename)) return parseOpml(content);
  if (isBrainstormsJsonFile(filename)) return parseBrainstormsJson(content);
  throw new Error(`Unsupported mindmap file format: ${filename}`);
}

export interface MindmapConversionResult {
  cardCount: number;
  deckName: string;
  apkgPath?: string;
}

export async function convertMindmapFileToApkg(
  filename: string,
  content: Buffer,
  outputDir: string
): Promise<MindmapConversionResult> {
  const deckName = filename
    .replace(/\.brainstorms\.json$/i, '')
    .replace(/\.opml$/i, '');

  const data = parseMindmapFile(filename, content.toString('utf-8'));
  const notes = mindmapToNotes(data);

  fs.mkdirSync(outputDir, { recursive: true });
  const deckInfo = buildMindmapDeckInfo(deckName, notes);

  const exporter = new CustomExporter(deckName, outputDir);
  exporter.configure(deckInfo as never);
  await exporter.save();

  return {
    cardCount: notes.length,
    deckName: getDeckFilename(deckName),
    apkgPath: exporter.savedApkgPath ?? undefined,
  };
}
