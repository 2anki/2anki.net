import Package from '../../lib/parser/Package';
import Workspace from '../../lib/parser/WorkSpace';
import { File } from '../../lib/zip/zip';
import { isAnkiAppExportXml, isXmlFile } from '../../lib/storage/checks';
import { AnkiAppExportError } from '../../lib/parser/parsers/parseAnkiAppXml';
import { isZipContentFileSupported } from './isZipContentFileSupported';
import { PackageResult } from './GeneratePackagesUseCase';
import {
  convertAnkiAppExportToApkg,
  describeSkippedMediaOnlyCards,
} from './ConvertAnkiAppExportUseCase';

export const ANKI_APP_ZIP_NO_DECK_MESSAGE =
  'No deck XML found in this zip. Export the deck from AnkiApp and upload the whole zip.';

const isBlobEntry = (name: string) => /(^|\/)blobs\//i.test(name);

const hasExtension = (name: string) => name.includes('.');

const baseName = (name: string) => name.split('/').pop() ?? name;

type FileWithContents = File & { contents: Buffer | Uint8Array | string };

function findDeckXmlEntries(files: File[]): FileWithContents[] {
  const withContents = files.filter(
    (file): file is FileWithContents => file.contents != null
  );
  const sniffed = withContents.filter((file) =>
    isAnkiAppExportXml(file.contents)
  );
  if (sniffed.length > 0) return sniffed;

  const hasConvertibleCompanions = files.some(
    (file) => hasExtension(file.name) && isZipContentFileSupported(file.name)
  );
  if (hasConvertibleCompanions) return [];

  return withContents.filter((file) => isXmlFile(file.name));
}

export async function convertAnkiAppDecksFromZip(
  files: File[],
  workspace: Workspace
): Promise<PackageResult | null> {
  const deckXmlEntries = findDeckXmlEntries(files);

  if (deckXmlEntries.length === 0) {
    if (files.some((file) => isBlobEntry(file.name))) {
      throw new AnkiAppExportError(ANKI_APP_ZIP_NO_DECK_MESSAGE);
    }
    return null;
  }

  const packages: Package[] = [];
  const warnings: string[] = [];

  for (const file of deckXmlEntries) {
    const result = await convertAnkiAppExportToApkg(
      baseName(file.name),
      typeof file.contents === 'string'
        ? file.contents
        : Buffer.from(file.contents),
      workspace.location
    );
    const pkg = new Package(result.deckName, result.cardCount, 0, 0);
    pkg.apkgPath = result.apkgPath;
    packages.push(pkg);
    if (result.skippedMediaOnlyCount > 0) {
      warnings.push(
        describeSkippedMediaOnlyCards(result.skippedMediaOnlyCount)
      );
    }
  }

  return { packages, warnings };
}
