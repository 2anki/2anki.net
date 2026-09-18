"""Tests for the pinned note-level mod hook in N2ANote."""
import sqlite3
import tempfile
import zipfile
import os

from genanki import Model, Deck, Package

from helpers.n2a_note import N2ANote

_MODEL = Model(
    1091735104,
    "n2a-basic-test",
    fields=[{"name": "Front"}, {"name": "Back"}],
    templates=[
        {"name": "Card 1", "qfmt": "{{Front}}", "afmt": "{{FrontSide}}{{Back}}"}
    ],
)


def _write_and_read_note_mod(note, timestamp=1_700_000_000):
    deck = Deck(deck_id=2020, name="Test Deck")
    deck.add_note(note)
    package = Package([deck])
    with tempfile.TemporaryDirectory() as tmpdir:
        apkg_path = os.path.join(tmpdir, "out.apkg")
        package.write_to_file(apkg_path, timestamp=timestamp)
        with zipfile.ZipFile(apkg_path) as zf:
            zf.extract("collection.anki2", tmpdir)
        db_path = os.path.join(tmpdir, "collection.anki2")
        conn = sqlite3.connect(db_path)
        try:
            row = conn.execute("SELECT mod, guid FROM notes").fetchone()
        finally:
            conn.close()
    return row


def test_pinned_mod_overrides_export_timestamp():
    note = N2ANote(model=_MODEL, fields=["Q1", "A1"], guid="fixed-guid-1", mod=1_600_000_000)
    mod, guid = _write_and_read_note_mod(note, timestamp=1_700_000_000)
    assert mod == 1_600_000_000
    assert guid == "fixed-guid-1"


def test_unset_mod_falls_back_to_export_timestamp():
    note = N2ANote(model=_MODEL, fields=["Q1", "A1"], guid="fixed-guid-2", mod=None)
    mod, _ = _write_and_read_note_mod(note, timestamp=1_700_000_000)
    assert mod == 1_700_000_000


def test_two_reexports_with_the_same_pinned_mod_produce_identical_note_mod():
    note_a = N2ANote(model=_MODEL, fields=["Q1", "A1"], guid="fixed-guid-3", mod=1_650_000_000)
    note_b = N2ANote(model=_MODEL, fields=["Q1", "A1"], guid="fixed-guid-3", mod=1_650_000_000)
    mod_a, _ = _write_and_read_note_mod(note_a, timestamp=1_700_000_000)
    mod_b, _ = _write_and_read_note_mod(note_b, timestamp=1_800_000_000)
    assert mod_a == mod_b == 1_650_000_000
