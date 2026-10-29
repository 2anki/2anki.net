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


def _pin_collection(path):
    """Returns whether any note type's mod had to come down."""
    connection = sqlite3.connect(path)
    try:
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
                        out.writestr(entry, archive.read(entry))
        return True
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: pin_shared_notetypes.py <source.apkg> <destination.apkg>")
    if not pin_shared_notetypes(sys.argv[1], sys.argv[2]):
        sys.exit(NOTHING_TO_PIN)
