import importlib.util as _ilu
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from helpers.n2a_model import NOTETYPE_MOD

_spec = _ilu.spec_from_file_location(
    "create_deck_pin_shared_notetypes_unit",
    Path(__file__).parents[1] / "pin_shared_notetypes.py",
)
pin = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(pin)


def _apkg(tmp_path, mod, *, col_as_view=False, extra=None):
    db_path = tmp_path / "collection.anki2"
    connection = sqlite3.connect(db_path)
    models = json.dumps({"1": {"id": 1, "name": "2anki Basic", "mod": mod}})
    if col_as_view:
        connection.execute(f"CREATE VIEW col AS SELECT '{models}' AS models")
    else:
        connection.execute("CREATE TABLE col (models TEXT)")
        connection.execute("INSERT INTO col (models) VALUES (?)", (models,))
    connection.commit()
    connection.close()
    apkg = tmp_path / "deck.apkg"
    with zipfile.ZipFile(apkg, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(db_path, "collection.anki2")
        archive.writestr("media", "{}")
        for name, data in (extra or {}).items():
            archive.writestr(name, data)
    return str(apkg)


def _mods(apkg):
    with zipfile.ZipFile(apkg) as archive:
        data = archive.read("collection.anki2")
    db_path = Path(apkg).with_suffix(".read.anki2")
    db_path.write_bytes(data)
    connection = sqlite3.connect(db_path)
    try:
        models = json.loads(connection.execute("SELECT models FROM col").fetchone()[0])
    finally:
        connection.close()
    return [model["mod"] for model in models.values()]


def test_an_ios_built_note_type_stamped_with_its_build_time_is_pinned(tmp_path):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600, extra={"0": b"image-bytes"})
    out = tmp_path / "out.apkg"

    assert pin.pin_shared_notetypes(shared, str(out)) is True
    assert _mods(str(out)) == [NOTETYPE_MOD]
    with zipfile.ZipFile(out) as archive:
        assert archive.read("0") == b"image-bytes"


def test_a_col_that_is_not_a_table_is_left_alone(tmp_path):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600, col_as_view=True)

    assert pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg")) is False


@pytest.mark.parametrize(
    "cap, value",
    [("MAX_ENTRIES", 1), ("MAX_TOTAL_BYTES", 10), ("MAX_COLLECTION_BYTES", 10)],
)
def test_an_archive_over_a_cap_is_refused(tmp_path, monkeypatch, cap, value):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600)
    monkeypatch.setattr(pin, cap, value)

    with pytest.raises(pin.RefusedArchive):
        pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg"))


def test_a_newer_format_package_is_sent_as_stored(tmp_path):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600, extra={"collection.anki21b": b"zstd"})

    assert pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg")) is False

