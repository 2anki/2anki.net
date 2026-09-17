import importlib.util as _ilu
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import pytest

anki = pytest.importorskip("anki")
from anki.collection import Collection, ImportAnkiPackageRequest

_spec = _ilu.spec_from_file_location(
    "create_deck_script_anki_import",
    Path(__file__).parents[1] / "create_deck.py",
)
_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
build_one_deck = _mod.build_one_deck

REPO_ROOT = Path(__file__).parents[2]
TEMPLATE_DIR = str(REPO_ROOT / "src" / "templates") + os.sep
FIXTURE = Path(__file__).parents[1] / "fixtures" / "Table-crash-empty-back" / "deck_info.json"
IO_SCRIPT = Path(__file__).parents[1] / "create_io_deck.py"

NOTE_MOD_ADVANCE_SECONDS = 1.1

IMAGE_OCCLUSION_STOCK_KIND = 6
IO_FIELD_ORDER = ["Occlusion", "Image", "Header", "Back Extra", "Comments"]
FAKE_IMAGE_BYTES = b"fake-image-bytes"


def _build_io_apkg(build_dir: Path) -> str:
    (build_dir / "img.png").write_bytes(FAKE_IMAGE_BYTES)
    deck_info = {
        "deckName": "IO Import Test",
        "mode": "hide_all",
        "images": [
            {
                "imageName": "img.png",
                "header": "Cell anatomy",
                "rects": [{"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2, "label": ""}],
            }
        ],
    }
    (build_dir / "deck_info.json").write_text(json.dumps(deck_info))
    result = subprocess.run(
        [sys.executable, str(IO_SCRIPT), str(build_dir)],
        cwd=str(build_dir),
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip().splitlines()[-1]


def _build_apkg(build_dir: Path) -> str:
    shutil.copy(FIXTURE, build_dir / "deck_info.json")
    previous_dir = os.getcwd()
    os.chdir(build_dir)
    try:
        return build_one_deck(str(build_dir / "deck_info.json"), TEMPLATE_DIR)
    finally:
        os.chdir(previous_dir)


def _import(collection: Collection, apkg_path: str):
    request = ImportAnkiPackageRequest(package_path=apkg_path)
    return collection.import_anki_package(request).log


def _collection_db_name(extract_dir: Path) -> str:
    if (extract_dir / "collection.anki21").exists():
        return "collection.anki21"
    return "collection.anki2"


def _strip_notetype_ids(apkg_path: str, out_path: str) -> str:
    """
    Rewrites the packaged notetypes to look like a pre-#4407 collection: no
    field/template/original ids, and a notetype `mod` older than the shared
    NOTETYPE_MOD constant. Both an old collection's real export-time mod and
    a freshly-built one carry the same frozen constant today, so without
    backdating mod here a re-export in this test would tie (not beat) the
    local copy and Anki would skip the field-id write it's meant to prove.
    """
    extract_dir = Path(out_path).with_suffix(".extract")
    extract_dir.mkdir()
    with zipfile.ZipFile(apkg_path) as archive:
        archive.extractall(extract_dir)
    db_path = extract_dir / _collection_db_name(extract_dir)
    connection = sqlite3.connect(db_path)
    try:
        models = json.loads(connection.execute("SELECT models FROM col").fetchone()[0])
        for notetype in models.values():
            notetype.pop("originalId", None)
            notetype["mod"] = 1
            for field in notetype["flds"]:
                field.pop("id", None)
            for template in notetype["tmpls"]:
                template.pop("id", None)
        connection.execute("UPDATE col SET models = ?", (json.dumps(models),))
        connection.commit()
    finally:
        connection.close()
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for entry in extract_dir.iterdir():
            archive.write(entry, entry.name)
    return out_path


def _n2a_notetype_ids(collection: Collection) -> list[int]:
    return [nt["id"] for nt in collection.models.all() if nt["name"].startswith("n2a")]


def test_generated_deck_imports_then_reimports_without_conflicts(tmp_path):
    build_dir = tmp_path / "build"
    build_dir.mkdir()
    apkg = _build_apkg(build_dir)

    collection = Collection(str(tmp_path / "collection.anki2"))
    try:
        first = _import(collection, apkg)
        assert first.found_notes > 0
        assert len(first.new) == first.found_notes
        assert len(first.conflicting) == 0

        notetypes_after_first = len(collection.models.all())

        second = _import(collection, apkg)
        assert len(second.new) == 0
        assert len(second.conflicting) == 0
        assert len(second.duplicate) + len(second.updated) == second.found_notes
        assert len(collection.models.all()) == notetypes_after_first
    finally:
        collection.close()


def test_fresh_reexport_imports_as_updated_without_conflicts(tmp_path):
    first_build = tmp_path / "first"
    first_build.mkdir()
    first_apkg = _build_apkg(first_build)

    collection = Collection(str(tmp_path / "collection.anki2"))
    try:
        first = _import(collection, first_apkg)
        assert len(first.new) == first.found_notes > 0
        notetypes_after_first = len(collection.models.all())

        time.sleep(NOTE_MOD_ADVANCE_SECONDS)

        second_build = tmp_path / "second"
        second_build.mkdir()
        second_apkg = _build_apkg(second_build)

        second = _import(collection, second_apkg)
        assert len(second.new) == 0
        assert len(second.conflicting) == 0
        assert len(second.updated) == second.found_notes
        assert len(collection.models.all()) == notetypes_after_first
    finally:
        collection.close()


def test_returning_user_reimport_writes_field_ids_in_place(tmp_path):
    first_build = tmp_path / "first"
    first_build.mkdir()
    with_ids_apkg = _build_apkg(first_build)
    stripped_apkg = _strip_notetype_ids(with_ids_apkg, str(tmp_path / "stripped.apkg"))

    collection_path = str(tmp_path / "collection.anki2")
    collection = Collection(collection_path)
    try:
        first = _import(collection, stripped_apkg)
        assert first.found_notes > 0
        assert len(first.new) == first.found_notes
        assert len(first.conflicting) == 0

        notetype_ids = _n2a_notetype_ids(collection)
        assert len(notetype_ids) > 0
        for notetype_id in notetype_ids:
            assert collection.models.get(notetype_id)["flds"][0].get("id") is None

        notetypes_after_first = len(collection.models.all())
    finally:
        collection.close()

    time.sleep(NOTE_MOD_ADVANCE_SECONDS)

    second_build = tmp_path / "second"
    second_build.mkdir()
    reexport_apkg = _build_apkg(second_build)

    collection = Collection(collection_path)
    try:
        second = _import(collection, reexport_apkg)
        assert len(second.new) == 0
        assert len(second.conflicting) == 0
        assert len(second.updated) == second.found_notes
        assert len(collection.models.all()) == notetypes_after_first
    finally:
        collection.close()

    reopened = Collection(collection_path)
    try:
        for notetype_id in notetype_ids:
            notetype = reopened.models.get(notetype_id)
            assert all(field.get("id") is not None for field in notetype["flds"])
            assert all(template.get("id") is not None for template in notetype["tmpls"])
            assert notetype.get("originalId") == notetype_id
    finally:
        reopened.close()


def test_io_deck_notetype_is_editable_by_ankis_mask_editor(tmp_path):
    build_dir = tmp_path / "io"
    build_dir.mkdir()
    apkg = _build_io_apkg(build_dir)

    collection = Collection(str(tmp_path / "collection.anki2"))
    try:
        log = _import(collection, apkg)
        assert log.found_notes == 1
        assert len(log.new) == 1
        assert len(log.conflicting) == 0

        io_notetypes = [
            nt for nt in collection.models.all() if nt["name"] == "2anki Image Occlusion"
        ]
        assert len(io_notetypes) == 1
        notetype = io_notetypes[0]
        assert notetype["originalStockKind"] == IMAGE_OCCLUSION_STOCK_KIND
        assert [field["name"] for field in notetype["flds"]] == IO_FIELD_ORDER
        assert [field["tag"] for field in notetype["flds"]] == [0, 1, 2, 3, 4]
        assert [
            field.get("preventDeletion", False) for field in notetype["flds"]
        ] == [True, True, True, True, False]
    finally:
        collection.close()


def test_io_deck_notetype_does_not_collide_with_ankis_stock_image_occlusion(tmp_path):
    build_dir = tmp_path / "io"
    build_dir.mkdir()
    apkg = _build_io_apkg(build_dir)

    collection = Collection(str(tmp_path / "collection.anki2"))
    try:
        _import(collection, apkg)
        names = [nt["name"] for nt in collection.models.all()]
        assert "2anki Image Occlusion" in names
        assert "Image Occlusion" in names
        assert "2anki Image Occlusion+" not in names
        assert "Image Occlusion+" not in names
    finally:
        collection.close()


def test_reimport_with_ids_is_all_duplicate(tmp_path):
    build_dir = tmp_path / "build"
    build_dir.mkdir()
    apkg = _build_apkg(build_dir)

    collection = Collection(str(tmp_path / "collection.anki2"))
    try:
        first = _import(collection, apkg)
        assert len(first.new) == first.found_notes > 0

        second = _import(collection, apkg)
        assert len(second.new) == 0
        assert len(second.updated) == 0
        assert len(second.conflicting) == 0
        assert len(second.duplicate) == second.found_notes
    finally:
        collection.close()


def test_reexport_does_not_clobber_a_users_local_css_edit(tmp_path):
    """
    The #4407 regression: stock genanki stamps notetype `mod` with the
    export timestamp on every write, so a plain re-upload always looked
    newer than the user's collection and Anki overwrote any CSS edit the
    user made there. N2AModel pins `mod` to a shared constant instead, so
    a same-version re-export must leave the user's edit alone.
    """
    build_dir = tmp_path / "build"
    build_dir.mkdir()
    apkg = _build_apkg(build_dir)

    collection_path = str(tmp_path / "collection.anki2")
    collection = Collection(collection_path)
    try:
        _import(collection, apkg)
        notetype_id = _n2a_notetype_ids(collection)[0]
        notetype = collection.models.get(notetype_id)
        notetype["css"] = "/* user's own edit */ .card { color: red; }"
        collection.models.update_dict(notetype)
    finally:
        collection.close()

    time.sleep(NOTE_MOD_ADVANCE_SECONDS)

    reexport_dir = tmp_path / "reexport"
    reexport_dir.mkdir()
    reexport_apkg = _build_apkg(reexport_dir)

    collection = Collection(collection_path)
    try:
        _import(collection, reexport_apkg)
        notetype = collection.models.get(notetype_id)
        assert "user's own edit" in notetype["css"]
    finally:
        collection.close()
