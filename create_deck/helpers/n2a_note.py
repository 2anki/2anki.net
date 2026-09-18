"""
genanki Note that lets the caller pin the notes-row `mod` instead of
export time.

Anki only overwrites a locally-edited note when the incoming note's `mod`
is newer than the local copy's -- the same rule N2AModel pins for
notetypes (#4407/#4447). Stock genanki stamps every note with the export
timestamp, so a re-upload of an unedited deck still looks "newer" than a
user's own in-Anki edit and silently wipes it.

`mod` here is the upload-identity ledger's `content_changed_at`
(src/lib/anki/uploadCardIdentity.ts, #4445): the time our own rendered
content for this note last changed, independent of when the file happened
to be re-exported. When our content is byte-identical to the last upload,
the caller passes the same mod as last time, so the note carries no newer
timestamp on re-import and Anki leaves the user's edit alone.

Card-row mod (scheduling) is left at the export timestamp -- only the
notes-row mod this class writes is pinned, so review history and due
dates are unaffected. write_to_db is fully reimplemented rather than
wrapped because the two mod values would otherwise have to share the one
`timestamp` argument genanki threads through both inserts.
"""
from genanki import Note
from genanki.builtin_models import _fix_deprecated_builtin_models_and_warn


class N2ANote(Note):
    """
    Note whose stored `mod` can be pinned via the `mod` constructor kwarg.
    Falls back to genanki's normal export-timestamp behavior when `mod`
    is None, so callers outside the upload-identity path are unaffected.
    """

    def __init__(self, *args, mod=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.mod = mod

    def write_to_db(self, cursor, timestamp, deck_id, id_gen):
        note_mod = timestamp if self.mod is None else self.mod
        self.fields = _fix_deprecated_builtin_models_and_warn(self.model, self.fields)
        self._check_number_model_fields_matches_num_fields()
        self._check_invalid_html_tags_in_fields()
        cursor.execute('INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?);', (
            next(id_gen),                 # id
            self.guid,                    # guid
            self.model.model_id,          # mid
            int(note_mod),                 # mod
            -1,                           # usn
            self._format_tags(),          # tags
            self._format_fields(),        # flds
            self.sort_field,              # sfld
            0,                            # csum, can be ignored
            0,                            # flags
            '',                           # data
        ))

        note_id = cursor.lastrowid
        for card in self.cards:
            card.write_to_db(cursor, timestamp, deck_id, note_id, id_gen, self.due)
