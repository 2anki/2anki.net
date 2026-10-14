"""
A note as 2anki hands it to the packager.

`mod` pins the notes-row mtime instead of the export time. Anki only overwrites
a locally-edited note when the incoming note's `mod` is newer than the local
copy's, the same rule N2AModel pins for notetypes (#4407/#4447). A packager
that stamps every note with the export time makes a re-upload of an unedited
deck look "newer" than a user's own in-Anki edit and silently wipes it.

`mod` here is the upload-identity ledger's `content_changed_at`
(src/lib/anki/uploadCardIdentity.ts, #4445): the time our own rendered content
for this note last changed, independent of when the file happened to be
re-exported. When our content is byte-identical to the last upload, the caller
passes the same mod as last time, so the note carries no newer timestamp on
re-import and Anki leaves the user's edit alone. `None` leaves the mtime Anki
assigns at build time, so callers outside the upload-identity path are
unaffected. Card rows keep their build-time mtime either way, so review history
and due dates are untouched.
"""
from dataclasses import dataclass, field


@dataclass
class N2ANote:
    """One note to add: its N2AModel, field values, tags, guid and pinned mod."""

    model: object
    fields: list = field(default_factory=list)
    tags: list = field(default_factory=list)
    guid: str | None = None
    mod: int | None = None
