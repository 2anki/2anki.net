"""
#5043: a note type whose CSS carries the deck style takes its mod from the
time the user last changed a style option, floored at NOTETYPE_MOD. Note
types whose CSS does not carry that style keep the pinned constant, so a
style change never overwrites a local edit it would not change.
"""
import importlib.util
import json
import os
import sqlite3
import zipfile
from pathlib import Path

import pytest

from helpers.n2a_model import NOTETYPE_MOD

REPO_ROOT = Path(__file__).parents[2]
TEMPLATE_DIR = str(REPO_ROOT / "src" / "templates") + os.sep

_spec = importlib.util.spec_from_file_location(
    "create_deck_style_changed_at", REPO_ROOT / "create_deck" / "create_deck.py"
)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
build_one_deck = _module.build_one_deck

DECK_STYLE = ".card { font-size: 40px; }"
LATER = NOTETYPE_MOD + 600


def _card(name, **extra):
    card = {
        "name": name,
        "back": "Answer",
        "number": 0,
        "tags": [],
        "media": [],
        "cloze": False,
        "enableInput": False,
    }
    card.update(extra)
    return card


def _cards():
    return [
        _card("Basic front"),
        _card("{{c1::Cloze}} front", cloze=True),
        _card("Typed front", enableInput=True, answer="Typed"),
        _card("MCQ front", mcq=True, options=["A", "B"], correctIndices=[0]),
        _card("Hierarchy front", hierarchy=True, h1="Chapter"),
        _card(
            "Custom front",
            customFields=["Term", "Meaning", "Note"],
            customFieldNames=["Term", "Meaning", "Note"],
            customModelName="Imported vocab",
        ),
    ]


def _mods(tmp_path, settings, style=DECK_STYLE):
    deck_info = [
        {"id": 42, "name": "Styled", "cards": _cards(), "style": style, "settings": settings}
    ]
    (tmp_path / "deck_info.json").write_text(json.dumps(deck_info))
    previous = os.getcwd()
    os.chdir(tmp_path)
    try:
        apkg = build_one_deck(str(tmp_path / "deck_info.json"), TEMPLATE_DIR)
    finally:
        os.chdir(previous)
    extract_dir = tmp_path / "unpacked"
    with zipfile.ZipFile(apkg) as archive:
        archive.extractall(extract_dir)
    connection = sqlite3.connect(extract_dir / "collection.anki21")
    try:
        models = json.loads(connection.execute("select models from col").fetchone()[0])
    finally:
        connection.close()
    return {model["name"]: model["mod"] for model in models.values()}


def test_styled_note_types_take_the_later_style_change_time(tmp_path):
    mods = _mods(tmp_path, {"styleChangedAt": LATER})
    assert mods["n2a-basic"] == LATER
    assert mods["n2a-cloze"] == LATER
    assert mods["n2a-input"] == LATER
    assert mods["n2a-hierarchy"] == LATER


def test_the_mcq_note_type_keeps_the_pinned_mod(tmp_path):
    assert _mods(tmp_path, {"styleChangedAt": LATER})["n2a-mcq"] == NOTETYPE_MOD


def test_an_apkg_input_custom_note_type_keeps_the_pinned_mod(tmp_path):
    mods = _mods(tmp_path, {"styleChangedAt": LATER})
    assert mods["Imported vocab"] == NOTETYPE_MOD


@pytest.mark.parametrize(
    "style_changed_at",
    [None, 0, NOTETYPE_MOD - 1, -5, "1999999999", 1.5e9, True, [LATER], 2**63],
)
def test_a_missing_older_or_malformed_change_time_keeps_the_pinned_mod(
    tmp_path, style_changed_at
):
    settings = {} if style_changed_at is None else {"styleChangedAt": style_changed_at}
    assert set(_mods(tmp_path, settings).values()) == {NOTETYPE_MOD}


@pytest.mark.parametrize("template", ["nostyle", "abhiyan", "alex_deluxe"])
def test_a_template_that_drops_the_deck_style_keeps_the_pinned_mod(tmp_path, template):
    mods = _mods(tmp_path, {"styleChangedAt": LATER, "template": template})
    assert set(mods.values()) == {NOTETYPE_MOD}


def test_a_custom_note_type_with_its_own_css_keeps_the_pinned_mod(tmp_path):
    own = {"styling": ".mine { color: teal; }", "front": "{{Front}}", "back": "{{Back}}"}
    mods = _mods(
        tmp_path,
        {"styleChangedAt": LATER, "template": "custom", "n2aBasic": own},
    )
    assert mods["n2a-basic"] == NOTETYPE_MOD
