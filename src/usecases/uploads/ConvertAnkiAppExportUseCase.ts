import fs from 'node:fs';

import { parseAnkiAppXml } from '../../lib/parser/parsers/parseAnkiAppXml';
import { buildMindmapDeckInfo } from '../mindmaps/buildMindmapDeckInfo';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import getDeckFilename from '../../lib/anki/getDeckFilename';

export interface AnkiAppConversionResult {
  deckName: string;
  cardCount: number;
  skippedMediaOnlyCount: number;
  apkgPath?: string;
}

export function describeSkippedMediaOnlyCards(count: number): string {
  return count === 1
    ? '1 card skipped (media-only)'
    : `${count} cards skipped (media-only)`;
}

export async function convertAnkiAppExportToApkg(
  filename: string,
  content: Buffer | string,
  outputDir: string
): Promise<AnkiAppConversionResult> {
  const xml = typeof content === 'string' ? content : content.toString('utf-8');
  const parsed = parseAnkiAppXml(xml);
  const deckName =
    parsed.name || filename.replace(/\.xml$/i, '').trim() || 'Untitled deck';

  fs.mkdirSync(outputDir, { recursive: true });
  const deckInfo = buildMindmapDeckInfo(deckName, parsed.notes);

  const exporter = new CustomExporter(deckName, outputDir);
  exporter.configure(deckInfo as never);
  await exporter.save();

  console.info('[ankiapp] converted', {
    cardCount: parsed.notes.length,
    skippedMediaOnlyCount: parsed.skippedMediaOnlyCount,
  });

  return {
    deckName: getDeckFilename(deckName),
    cardCount: parsed.notes.length,
    skippedMediaOnlyCount: parsed.skippedMediaOnlyCount,
    apkgPath: exporter.savedApkgPath ?? undefined,
  };
}
