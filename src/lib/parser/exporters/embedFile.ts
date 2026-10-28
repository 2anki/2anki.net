import fs, { existsSync } from 'fs';
import path from 'path';

import { File } from '../../zip/zip';
import { SuffixFrom } from '../../misc/file';
import getUniqueFileName from '../../misc/getUniqueFileName';
import CustomExporter from './CustomExporter';
import Workspace from '../WorkSpace';

const readFromWorkspaceLocation = (
  location: string,
  filePath: string
): File | undefined => {
  const fullPath = path.resolve(location, filePath);
  const root = path.resolve(location) + path.sep;
  if (fullPath.startsWith(root) && existsSync(fullPath)) {
    const buffer = fs.readFileSync(fullPath);
    return {
      name: fullPath,
      contents: buffer,
    } as File;
  }
  return undefined;
};

const getFile = (
  exporter: CustomExporter,
  files: File[],
  filePath: string,
  workspace: Workspace,
  fallbackWorkspaceLocation?: string
): File | undefined => {
  const fromWorkspace = readFromWorkspaceLocation(workspace.location, filePath);
  if (fromWorkspace) {
    return fromWorkspace;
  }

  if (
    fallbackWorkspaceLocation &&
    fallbackWorkspaceLocation !== workspace.location
  ) {
    const fromFallback = readFromWorkspaceLocation(
      fallbackWorkspaceLocation,
      filePath
    );
    if (fromFallback) {
      return fromFallback;
    }
  }

  const asRootFile = files.find((f) => f.name === filePath);
  if (asRootFile) {
    return asRootFile;
  }
  const parent = exporter.firstDeckName.replace(/.html /, '/');
  const asChildFile = files.find((f) => f.name === `${parent}/${filePath}`);
  if (asChildFile) {
    return asChildFile;
  }

  /*
   * Could not find file, try to find it by ending.
   * This happens in deeply nested directories.
   * Example: using a huge database
   * Normalize backslashes (Windows ZIP entries use backslashes).
   */
  const normalized = filePath.replace(/\.\.\//g, '');
  const normalizedFilePath = filePath.replaceAll('\\', '/');
  const usingSuffix = files.find((f) => {
    const normalizedName = f.name.replaceAll('\\', '/');
    return (
      normalizedName.endsWith(normalizedFilePath) ||
      normalizedName.endsWith(normalized)
    );
  });
  if (usingSuffix) {
    return usingSuffix;
  }

  /*
   * Last resort: match by filename only.
   * Mirrors ClaudeService's resolveMediaPath behaviour.
   * When multiple files share the same filename, prefer the one whose
   * directory is closest to the requesting path's directory.
   */
  const filename = normalizedFilePath.split('/').pop();
  if (filename) {
    const matches = files.filter((f) => {
      const normalizedName = f.name.replaceAll('\\', '/');
      return (
        normalizedName === filename || normalizedName.endsWith('/' + filename)
      );
    });
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      const requestDir = normalizedFilePath.split('/').slice(0, -1).join('/');
      const scored = matches.map((f) => {
        const fDir = f.name
          .replaceAll('\\', '/')
          .split('/')
          .slice(0, -1)
          .join('/');
        const reqParts = requestDir.split('/');
        const fParts = fDir.split('/');
        let shared = 0;
        while (
          shared < reqParts.length &&
          shared < fParts.length &&
          reqParts[shared] === fParts[shared]
        ) {
          shared++;
        }
        return { file: f, shared };
      });
      scored.sort((a, b) => b.shared - a.shared);
      return scored[0].file;
    }
  }

  return undefined;
};

interface EmbedFileInput {
  exporter: CustomExporter;
  files: File[];
  filePath: string;
  workspace: Workspace;
  fallbackWorkspaceLocation?: string;
}

export const embedFile = (input: EmbedFileInput): string | null => {
  const { exporter, files, filePath, workspace, fallbackWorkspaceLocation } =
    input;

  const suffix = SuffixFrom(filePath) ?? '';
  const file = getFile(
    exporter,
    files,
    filePath,
    workspace,
    fallbackWorkspaceLocation
  );

  /**
   * The found file can be a file path in the workspace or a file in the zip or url.
   * The contents is used first to avoid name conflicts. URL can have conflicts but so far
   * no bug reports.
   */
  if (file && file.contents) {
    const contents = file.contents as string;
    const newName = getUniqueFileName(contents) + suffix;
    exporter.addMedia(newName, contents);
    return newName;
  }

  console.debug(
    JSON.stringify({
      hint: 'Missing relative path',
      filePath: filePath,
      fileNames: files.map((f) => f.name),
    })
  );

  return null;
};
