"""
Writes a copy of an .apkg whose note types carry the shared NOTETYPE_MOD.

Every 2anki note type id is the same for every user, and Anki's default import
replaces a local note type when the incoming one has a newer mod. A deck built
after its owner changed a card style carries that newer mod (#5043), so
importing it from a share link would replace the importer's own style and
local edits. The copy served to other people keeps the pinned mod, so their
note types stay as they are.

Usage: pin_shared_notetypes.py <source.apkg> <destination.apkg>
Exits with NOTHING_TO_PIN, writing nothing, when no note type is newer than
the pinned mod, so the caller serves the original untouched.
"""

import json
import os
import shutil
import sqlite3
import sys
import tempfile
import zipfile

from helpers.n2a_model import NOTETYPE_MOD

COLLECTION_FILES = ("collection.anki21", "collection.anki2")
NOTHING_TO_PIN = 3
REFUSED = 4

# A shared deck can be one a user uploaded as-is, so the archive is untrusted.
# The same caps the deck preview applies (extractApkg.ts).
MAX_TOTAL_BYTES = 1024 * 1024 * 1024
MAX_COLLECTION_BYTES = 512 * 1024 * 1024
MAX_ENTRIES = 65536
COPY_CHUNK_BYTES = 1024 * 1024


class RefusedArchive(Exception):
    """The archive is over the size or entry caps."""


def _check_limits(entries):
    if len(entries) > MAX_ENTRIES:
        raise RefusedArchive("too many entries")
    if sum(entry.file_size for entry in entries) > MAX_TOTAL_BYTES:
        raise RefusedArchive("too large")
    for entry in entries:
        if entry.filename in COLLECTION_FILES and entry.file_size > MAX_COLLECTION_BYTES:
            raise RefusedArchive("collection too large")


def _pin_collection(path):
    """Returns whether any note type's mod had to come down."""
    connection = sqlite3.connect(path)
    try:
        kind = connection.execute(
            "SELECT type FROM sqlite_master WHERE name = 'col'"
        ).fetchone()
        if kind is None or kind[0] != "table":
            return False
        row = connection.execute("SELECT models FROM col").fetchone()
        if row is None or not row[0]:
            return False
        models = json.loads(row[0])
        newer = [nt for nt in models.values() if nt.get("mod", 0) > NOTETYPE_MOD]
        for notetype in newer:
            notetype["mod"] = NOTETYPE_MOD
        if newer:
            connection.execute("UPDATE col SET models = ?", (json.dumps(models),))
            connection.commit()
        return bool(newer)
    finally:
        connection.close()


def pin_shared_notetypes(source, destination):
    """Writes the pinned copy; returns False, writing nothing, if none was needed."""
    work_dir = tempfile.mkdtemp(prefix="pin-notetypes-")
    try:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            _check_limits(entries)
            if any(entry.filename == "collection.anki21b" for entry in entries):
                # The real collection is compressed and the anki2 beside it is a
                # placeholder; pinning that would change nothing that matters.
                return False
            collections = [e for e in entries if e.filename in COLLECTION_FILES]
            pinned = False
            for entry in collections:
                archive.extract(entry, work_dir)
                pinned = _pin_collection(os.path.join(work_dir, entry.filename)) or pinned
            if not pinned:
                return False
            with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as out:
                for entry in entries:
                    if entry.filename in COLLECTION_FILES:
                        out.write(os.path.join(work_dir, entry.filename), entry.filename)
                    else:
                        with archive.open(entry) as source_file, out.open(entry, "w") as target:
                            shutil.copyfileobj(source_file, target, COPY_CHUNK_BYTES)
        return True
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: pin_shared_notetypes.py <source.apkg> <destination.apkg>")
    try:
        if not pin_shared_notetypes(sys.argv[1], sys.argv[2]):
            sys.exit(NOTHING_TO_PIN)
    except RefusedArchive:
        sys.exit(REFUSED)
