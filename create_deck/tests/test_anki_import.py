import importlib.util as _ilu
import os
import shutil
import time
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

NOTE_MOD_ADVANCE_SECONDS = 1.1


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
