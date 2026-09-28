import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CLEANUP_AGE_SECONDS } from '../../../constants';

/**
 * Removes every top-level entry under a location whose mtime is older than
 * CLEANUP_AGE_SECONDS: conversion workspaces, multer temp files, stray
 * directories. The location root itself is never removed, and a fresh entry
 * is left alone as a unit, so an in-flight conversion keeps its workspace.
 *
 * Entries are inspected with lstat and removed with rmSync, neither of which
 * follows symlinks. That matters because the fallback zip path extracts with
 * bsdtar, which materialises a zip's symlink entries as real links inside the
 * workspace; a sweep that followed them would delete aged files wherever an
 * uploaded archive pointed.
 *
 * @param loc an absolute directory, or a name relative to os.tmpdir()
 */
function deleteFile(loc: string) {
  // Prod configures WORKSPACE_BASE and UPLOAD_BASE as absolute paths; joining
  // those onto os.tmpdir() pointed the sweep at a directory that does not
  // exist, so it never removed anything (#4568).
  const root = path.isAbsolute(loc) ? loc : path.join(os.tmpdir(), loc);
  const cutoffMs = Date.now() - CLEANUP_AGE_SECONDS * 1000;
  const startedAt = Date.now();

  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return;
  }

  let removed = 0;
  let failed = 0;
  for (const name of names) {
    const entry = path.join(root, name);
    try {
      if (fs.lstatSync(entry).mtimeMs > cutoffMs) {
        continue;
      }
      fs.rmSync(entry, { recursive: true, force: true });
      removed += 1;
    } catch {
      failed += 1;
    }
  }

  console.info('[cleanup] swept old files', {
    root,
    scanned: names.length,
    removed,
    failed,
    ms: Date.now() - startedAt,
  });
}

/**
 * A convenience function to batch delete old files.
 * @param locations
 */
export default function deleteOldFiles(locations: string[]) {
  locations.forEach((loc) => {
    deleteFile(loc);
  });
}
