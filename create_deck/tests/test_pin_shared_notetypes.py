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


def _apkg(
    tmp_path,
    mod,
    *,
    col_as_view=False,
    extra=None,
    trigger=False,
    name="2anki Basic",
    schema_sql=(),
):
    db_path = tmp_path / "collection.anki2"
    connection = sqlite3.connect(db_path)
    models = json.dumps({"1": {"id": 1, "name": name, "mod": mod}})
    if col_as_view:
        connection.execute(f"CREATE VIEW col AS SELECT '{models}' AS models")
    else:
        connection.execute("CREATE TABLE col (models TEXT)")
        connection.execute("INSERT INTO col (models) VALUES (?)", (models,))
    for statement in schema_sql:
        connection.execute(statement)
    if trigger:
        connection.execute("CREATE TABLE pad (x BLOB)")
        connection.execute(
            "CREATE TRIGGER grow AFTER UPDATE ON col BEGIN INSERT INTO pad VALUES (1); END"
        )
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


def test_a_col_that_is_not_a_table_is_refused(tmp_path):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600, col_as_view=True)

    with pytest.raises(pin.RefusedArchive):
        pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg"))


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


@pytest.mark.parametrize(
    "statement",
    [
        "CREATE TRIGGER grow AFTER UPDATE ON col BEGIN INSERT INTO pad VALUES (1); END",
        "CREATE /* hidden */ TRIGGER grow AFTER UPDATE ON col BEGIN INSERT INTO pad VALUES (1); END",
    ],
)
def test_a_trigger_written_any_way_is_refused(tmp_path, statement):
    shared = _apkg(
        tmp_path,
        NOTETYPE_MOD + 600,
        schema_sql=["CREATE TABLE pad (x BLOB)", statement],
    )

    with pytest.raises(pin.RefusedArchive):
        pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg"))


def test_a_collection_with_a_trigger_is_refused(tmp_path):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600, trigger=True)

    with pytest.raises(pin.RefusedArchive):
        pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg"))


def test_oversized_note_types_are_refused(tmp_path, monkeypatch):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600)
    monkeypatch.setattr(pin, "MAX_MODELS_BYTES", 10)

    with pytest.raises(pin.RefusedArchive):
        pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg"))


def test_its_scratch_files_live_beside_the_destination(tmp_path, monkeypatch):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600)
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    seen = []
    original = pin.shutil.rmtree

    def record(path, *args, **kwargs):
        seen.append(path)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(pin.shutil, "rmtree", record)
    pin.pin_shared_notetypes(shared, str(out_dir / "out.apkg"))

    assert [Path(p).parent for p in seen] == [out_dir]


def test_another_publishers_note_type_keeps_its_mod(tmp_path):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600, name="AnKingOverhaul")

    assert pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg")) is False


@pytest.mark.parametrize(
    "what, statements",
    [
        ("a second row", ["INSERT INTO col (models) VALUES (NULL)"]),
        ("an index", ["CREATE INDEX li ON col (length(models))"]),
        ("an index named in upper case", ["CREATE INDEX li ON COL (length(models))"]),
        (
            "a generated column",
            ["ALTER TABLE col ADD COLUMN pad BLOB GENERATED ALWAYS AS (zeroblob(10)) VIRTUAL"],
        ),
    ],
)
def test_a_collection_with_extra_schema_on_col_is_refused(tmp_path, what, statements):
    del what
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600, schema_sql=statements)

    with pytest.raises(pin.RefusedArchive):
        pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg"))


def test_a_repeated_collection_entry_is_refused(tmp_path):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600)
    with zipfile.ZipFile(shared, "a") as archive, pytest.warns(UserWarning):
        archive.writestr("collection.anki2", b"second copy")

    with pytest.raises(pin.RefusedArchive):
        pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg"))


def test_an_old_sqlite_refuses_rather_than_open_an_upload(tmp_path, monkeypatch):
    shared = _apkg(tmp_path, NOTETYPE_MOD + 600)
    monkeypatch.setattr(pin.sqlite3, "sqlite_version_info", (3, 30, 0))

    with pytest.raises(pin.RefusedArchive):
        pin.pin_shared_notetypes(shared, str(tmp_path / "out.apkg"))

