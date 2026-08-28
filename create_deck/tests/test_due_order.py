import json
import os
import sqlite3
import tempfile
import zipfile
from pathlib import Path

import importlib.util as _ilu

_spec = _ilu.spec_from_file_location(
    "create_deck_script_due",
    Path(__file__).parents[1] / "create_deck.py",
)
_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
build_one_deck = _mod.build_one_deck

REPO_ROOT = Path(__file__).parents[2]
TEMPLATE_DIR = str(REPO_ROOT / "src" / "templates") + os.sep


def _card(front: str, number: int, **extra) -> dict:
    card = {
        "name": front,
        "back": f"Back of {front}",
        "number": number,
        "tags": [],
        "media": [],
        "cloze": False,
        "enableInput": False,
    }
    card.update(extra)
    return card


def _deck(deck_id: int, name: str, cards: list) -> dict:
    return {"id": deck_id, "name": name, "cards": cards, "settings": {}}


def _read_card_rows(apkg_path: str) -> list:
    with zipfile.ZipFile(apkg_path) as zf:
        db_name = "collection.anki21" if "collection.anki21" in zf.namelist() else "collection.anki2"
        db_bytes = zf.read(db_name)
    with tempfile.NamedTemporaryFile(suffix=".anki2", delete=False) as tmp:
        tmp.write(db_bytes)
        tmp_path = tmp.name
    try:
        conn = sqlite3.connect(tmp_path)
        rows = conn.execute(
            "SELECT n.sfld, c.due FROM cards c JOIN notes n ON n.id = c.nid ORDER BY c.id"
        ).fetchall()
        conn.close()
    finally:
        os.unlink(tmp_path)
    return rows


def _build(deck_info: list, tmpdir: str) -> list:
    data_file = os.path.join(tmpdir, "deck_info.json")
    with open(data_file, "w", encoding="utf-8") as f:
        json.dump(deck_info, f)
    original_cwd = os.getcwd()
    try:
        os.chdir(tmpdir)
        apkg_path = build_one_deck(data_file, TEMPLATE_DIR)
    finally:
        os.chdir(original_cwd)
    assert apkg_path is not None
    return _read_card_rows(apkg_path)


class TestDueOrder:
    def test_cards_get_ascending_due_positions_in_document_order(self):
        deck_info = [
            _deck(1001, "Order", [_card("First", 0), _card("Second", 1), _card("Third", 2)])
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            rows = _build(deck_info, tmpdir)

        assert [due for _, due in rows] == [1, 2, 3]

    def test_due_positions_keep_counting_across_decks_in_one_apkg(self):
        deck_info = [
            _deck(1001, "Parent", [_card("P1", 0), _card("P2", 1)]),
            _deck(1002, "Parent::Child", [_card("C1", 0), _card("C2", 1)]),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            rows = _build(deck_info, tmpdir)

        assert [due for _, due in rows] == [1, 2, 3, 4]

    def test_due_position_follows_card_order_not_the_number_field(self):
        # `number` can be a Notion id string or a float for reversed notes;
        # the position in the deck is what carries document order.
        deck_info = [
            _deck(1001, "Notion", [_card("A", -1, notionId="abc"), _card("B", 5), _card("C", 0.5)])
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            rows = _build(deck_info, tmpdir)

        assert [due for _, due in rows] == [1, 2, 3]
