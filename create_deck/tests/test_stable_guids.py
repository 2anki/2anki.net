import json
import os
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import importlib.util as _ilu

import pytest

_spec = _ilu.spec_from_file_location(
    "create_deck_script",
    Path(__file__).parents[1] / "create_deck.py",
)
_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
build_one_deck = _mod.build_one_deck

REPO_ROOT = Path(__file__).parents[2]
TEMPLATE_DIR = str(REPO_ROOT / "src" / "templates") + os.sep


def _deck_info_basic(deck_name: str, front: str, back: str) -> list:
    return [
        {
            "id": abs(hash(deck_name)) % (10**10),
            "name": deck_name,
            "cards": [
                {
                    "name": front,
                    "back": back,
                    "number": 0,
                    "tags": [],
                    "media": [],
                    "cloze": False,
                    "enableInput": False,
                }
            ],
            "settings": {},
        }
    ]


def _deck_info_cards(deck_name: str, cards: list) -> list:
    return [
        {
            "id": abs(hash(deck_name)) % (10**10),
            "name": deck_name,
            "cards": [
                {
                    "name": front,
                    "back": back,
                    "number": i,
                    "tags": [],
                    "media": [],
                    "cloze": False,
                    "enableInput": False,
                }
                for i, (front, back) in enumerate(cards)
            ],
            "settings": {},
        }
    ]


def _with_cloze(deck_info: list, cloze: bool) -> list:
    for card in deck_info[0]["cards"]:
        card["cloze"] = cloze
    return deck_info


def _deck_info_with_notion_id(deck_name: str, front: str, back: str, notion_id: str) -> list:
    return [
        {
            "id": abs(hash(deck_name)) % (10**10),
            "name": deck_name,
            "cards": [
                {
                    "name": front,
                    "back": back,
                    "number": 0,
                    "tags": [],
                    "media": [],
                    "cloze": False,
                    "enableInput": False,
                    "notionId": notion_id,
                }
            ],
            "settings": {},
        }
    ]


def _read_guids_from_apkg(apkg_path: str) -> list:
    guids = []
    with zipfile.ZipFile(apkg_path) as zf:
        db_name = "collection.anki21" if "collection.anki21" in zf.namelist() else "collection.anki2"
        db_bytes = zf.read(db_name)

    import sqlite3
    import io
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA journal_mode=WAL")
    raw = db_bytes
    conn.close()

    with tempfile.NamedTemporaryFile(suffix=".anki2", delete=False) as tmp:
        tmp.write(db_bytes)
        tmp_path = tmp.name
    try:
        conn = sqlite3.connect(tmp_path)
        rows = conn.execute("SELECT guid FROM notes ORDER BY guid").fetchall()
        guids = [row[0] for row in rows]
        conn.close()
    finally:
        os.unlink(tmp_path)
    return guids


def _read_guids_from_apkg_in_order(apkg_path: str) -> list:
    with zipfile.ZipFile(apkg_path) as zf:
        db_name = "collection.anki21" if "collection.anki21" in zf.namelist() else "collection.anki2"
        db_bytes = zf.read(db_name)

    import sqlite3

    with tempfile.NamedTemporaryFile(suffix=".anki2", delete=False) as tmp:
        tmp.write(db_bytes)
        tmp_path = tmp.name
    try:
        conn = sqlite3.connect(tmp_path)
        # `id` is genanki's monotonic note id (assigned in the order notes
        # were added), so this preserves document order — unlike the
        # alphabetical `ORDER BY guid` the other helper uses, which the
        # collision-forking tests below need to line a guid back up with
        # the card that produced it.
        rows = conn.execute("SELECT guid FROM notes ORDER BY id").fetchall()
        conn.close()
    finally:
        os.unlink(tmp_path)
    return [row[0] for row in rows]


def _build_and_get_guids(deck_info: list, tmpdir: str, suffix: str) -> list:
    data_file = os.path.join(tmpdir, f"deck_info_{suffix}.json")
    with open(data_file, "w", encoding="utf-8") as f:
        json.dump(deck_info, f)
    original_cwd = os.getcwd()
    try:
        os.chdir(tmpdir)
        apkg_path = build_one_deck(data_file, TEMPLATE_DIR)
    finally:
        os.chdir(original_cwd)
    assert apkg_path is not None
    return _read_guids_from_apkg(apkg_path)


def _build_and_get_guids_in_order(deck_info: list, tmpdir: str, suffix: str) -> list:
    data_file = os.path.join(tmpdir, f"deck_info_{suffix}.json")
    with open(data_file, "w", encoding="utf-8") as f:
        json.dump(deck_info, f)
    original_cwd = os.getcwd()
    try:
        os.chdir(tmpdir)
        apkg_path = build_one_deck(data_file, TEMPLATE_DIR)
    finally:
        os.chdir(original_cwd)
    assert apkg_path is not None
    return _read_guids_from_apkg_in_order(apkg_path)


class TestStableGuids:
    def test_two_runs_of_same_input_produce_identical_guids(self):
        deck_info = _deck_info_basic("My Deck", "What is H2O?", "Water")
        with tempfile.TemporaryDirectory() as tmpdir:
            guids_first = _build_and_get_guids(deck_info, tmpdir, "first")
            guids_second = _build_and_get_guids(deck_info, tmpdir, "second")
        assert guids_first == guids_second

    def test_editing_back_field_keeps_guid_stable(self):
        front = "What is the capital of France?"
        with tempfile.TemporaryDirectory() as tmpdir:
            deck_info_v1 = _deck_info_basic("History", front, "Paris")
            deck_info_v2 = _deck_info_basic("History", front, "Paris — city of lights")
            guids_v1 = _build_and_get_guids(deck_info_v1, tmpdir, "v1")
            guids_v2 = _build_and_get_guids(deck_info_v2, tmpdir, "v2")
        assert guids_v1 == guids_v2

    def test_notion_id_card_guid_derived_from_notion_id_only(self):
        notion_id = "abc123-notion-block-id"
        with tempfile.TemporaryDirectory() as tmpdir:
            deck_info_v1 = _deck_info_with_notion_id("Science", "Original front", "back", notion_id)
            deck_info_v2 = _deck_info_with_notion_id("Science", "Renamed front", "different back", notion_id)
            guids_v1 = _build_and_get_guids(deck_info_v1, tmpdir, "v1")
            guids_v2 = _build_and_get_guids(deck_info_v2, tmpdir, "v2")
        assert guids_v1 == guids_v2

    def test_different_front_fields_produce_different_guids(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            deck_info_a = _deck_info_basic("My Deck", "Front A", "back")
            deck_info_b = _deck_info_basic("My Deck", "Front B", "back")
            guids_a = _build_and_get_guids(deck_info_a, tmpdir, "a")
            guids_b = _build_and_get_guids(deck_info_b, tmpdir, "b")
        assert guids_a != guids_b

    @pytest.mark.parametrize("cloze", [False, True])
    def test_escaped_front_keeps_the_guid_of_its_unescaped_text(self, cloze):
        raw = "Salt & water < sugar \"syrup\" it's &amp; here."
        escaped = "Salt &amp; water &lt; sugar &quot;syrup&quot; it&#39;s &amp;amp; here."
        with tempfile.TemporaryDirectory() as tmpdir:
            before = _build_and_get_guids(
                _with_cloze(_deck_info_basic("Biology", raw, "back"), cloze),
                tmpdir,
                "before",
            )
            after_info = _with_cloze(
                _deck_info_basic("Biology", escaped, "back"), cloze
            )
            after_info[0]["cards"][0]["frontEscaped"] = True
            after = _build_and_get_guids(after_info, tmpdir, "after")
        assert after == before

    @pytest.mark.parametrize("cloze", [False, True])
    def test_unflagged_front_is_keyed_as_written(self, cloze):
        escaped = "Salt &amp; water &lt; sugar &quot;syrup&quot; it&#39;s &amp;amp; here."
        unescaped = "Salt & water < sugar \"syrup\" it's &amp; here."
        with tempfile.TemporaryDirectory() as tmpdir:
            as_written = _build_and_get_guids(
                _with_cloze(_deck_info_basic("Biology", escaped, "back"), cloze),
                tmpdir,
                "written",
            )
            unescaped_guids = _build_and_get_guids(
                _with_cloze(_deck_info_basic("Biology", unescaped, "back"), cloze),
                tmpdir,
                "unescaped",
            )
        assert as_written != unescaped_guids

    def test_escaped_fronts_sharing_a_sentence_keep_their_numbering(self):
        raw = "It's salt & water < sugar here."
        escaped = "It&#39;s salt &amp; water &lt; sugar here."
        backs = ["Cells swell in it.", "Cells shrink in it."]
        with tempfile.TemporaryDirectory() as tmpdir:
            before = _build_and_get_guids_in_order(
                _deck_info_cards("Biology", [(raw, back) for back in backs]),
                tmpdir,
                "before",
            )
            after_info = _deck_info_cards(
                "Biology", [(escaped, back) for back in backs]
            )
            for card in after_info[0]["cards"]:
                card["frontEscaped"] = True
            after = _build_and_get_guids_in_order(after_info, tmpdir, "after")
        assert len(set(before)) == 2
        assert after == before

    def test_escaped_typed_answer_front_keeps_its_guid(self):
        raw = "It's salt & water.{{type:Input}}"
        escaped = "It&#39;s salt &amp; water.{{type:Input}}"
        back = "It's salt & water. Cells swell in it."
        with tempfile.TemporaryDirectory() as tmpdir:
            infos = []
            for front, flagged in ((raw, False), (escaped, True)):
                info = _deck_info_basic("Biology", front, back)
                card = info[0]["cards"][0]
                card["enableInput"] = True
                card["answer"] = back
                if flagged:
                    card["frontEscaped"] = True
                infos.append(info)
            before = _build_and_get_guids(infos[0], tmpdir, "before")
            after = _build_and_get_guids(infos[1], tmpdir, "after")
        assert after == before

    @pytest.mark.parametrize("cloze", [False, True])
    def test_reversed_and_mirrored_escaped_sentences_keep_their_guids(self, cloze):
        raw = "It's salt & water < sugar here."
        escaped = "It&#39;s salt &amp; water &lt; sugar here."
        paragraph = "<strong>It&#39;s</strong> salt &amp; water &lt; sugar here. More."
        with tempfile.TemporaryDirectory() as tmpdir:
            before = _build_and_get_guids_in_order(
                _with_cloze(
                    _deck_info_cards(
                        "Biology", [(raw, paragraph), (paragraph, raw)]
                    ),
                    cloze,
                ),
                tmpdir,
                "before",
            )
            after_info = _with_cloze(
                _deck_info_cards(
                    "Biology", [(escaped, paragraph), (paragraph, escaped)]
                ),
                cloze,
            )
            after_info[0]["cards"][0]["frontEscaped"] = True
            after_info[0]["cards"][1]["backEscaped"] = True
            after = _build_and_get_guids_in_order(after_info, tmpdir, "after")
            stale_flag_info = _with_cloze(
                _deck_info_cards(
                    "Biology", [(escaped, paragraph), (paragraph, escaped)]
                ),
                cloze,
            )
            stale_flag_info[0]["cards"][0]["frontEscaped"] = True
            stale_flag_info[0]["cards"][1]["frontEscaped"] = True
            stale_flag = _build_and_get_guids_in_order(
                stale_flag_info, tmpdir, "stale"
            )
        assert after == before
        assert stale_flag != before


class TestUseContentGuidMarker:
    def test_marker_forces_content_formula_over_notion_id(self):
        from helpers.guid import guid_for

        notion_id = "3917ab29-a11e-8047-9d97-cf0f00b3c8f7"
        marked = _deck_info_with_notion_id("Science", "front", "back", notion_id)
        marked[0]["useContentGuid"] = True
        unmarked = _deck_info_with_notion_id("Science", "front", "back", notion_id)
        with tempfile.TemporaryDirectory() as tmpdir:
            marked_guids = _build_and_get_guids(marked, tmpdir, "marked")
            unmarked_guids = _build_and_get_guids(unmarked, tmpdir, "unmarked")
        assert marked_guids == [guid_for("Science", "front", "basic")]
        assert unmarked_guids == [guid_for(notion_id)]

    def test_sidecar_written_next_to_deck_info(self):
        notion_id = "3917ab29-a11e-8047-9d97-cf0f00b3c8f7"
        deck_info = _deck_info_with_notion_id("Science", "front", "back", notion_id)
        deck_info[0]["useContentGuid"] = True
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids(deck_info, tmpdir, "sidecar")
            sidecar_files = list(Path(tmpdir).rglob("guids.json"))
            assert sidecar_files, "guids.json missing"
            records = json.loads(sidecar_files[0].read_text())
        assert records == [{"notionId": notion_id, "guid": guids[0]}]


class TestExplicitGuidPassthrough:
    def test_explicit_guid_wins_over_notion_id_and_content(self):
        deck_info = _deck_info_with_notion_id(
            "Science", "front", "back", "abc123-notion-block-id"
        )
        deck_info[0]["cards"][0]["guid"] = "LEDGER-GUID"
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids(deck_info, tmpdir, "explicit")
        assert guids == ["LEDGER-GUID"]


class TestGuidForCrossLanguageParity:
    """Vectors pinned in src/lib/anki/guid.test.ts as well.

    The TS port must stay byte-for-byte identical to genanki's guid_for;
    a drift on either side re-keys shipped decks.
    """

    VECTORS = [
        (("3647ab29-a11e-80a0-8f6f-f23a6c203d4e",), "LRX*dO0[7}"),
        (("3917ab29-a11e-8047-9d97-cf0f00b3c8f7",), "l@Cd.uzPA3"),
        (("c94d97e2-5d91-479c-9a1c-49799823bc9f",), "xD`j77z<VK"),
        (("23b40f2c-3dba-49d5-b38b-735ce6483110",), "noy-;K0O6x"),
        (("b38e3642-358c-4ca7-aef5-4c409d27ecf4",), "Om15k1LagY"),
        (("3647ab29-a11e-80a0-8f6f-f23a6c203d4e::0",), "t*4,@CGW|k"),
        (("3647ab29-a11e-80a0-8f6f-f23a6c203d4e::11",), "B#/MoB~v[t"),
        (("3647ab29-a11e-80a0-8f6f-f23a6c203d4e::rev",), "BohqBHt9<S"),
        (("",), "ME_YHw2?15"),
        (("a",), "IkF(BOZ;]l"),
        (("0",), "qn?z+W(gM{"),
        (("äöü ß emoji 📖 test",), "ti%Rzh:{0i"),
        (
            (
                "📖 Finanzbuchhaltung Allgemein",
                "<div class='toggle'>Was ist X?</div>",
                "cloze",
            ),
            "Bj.{CD|nUO",
        ),
        (("Deck", "front", "basic"), "t:%^!&3TCZ"),
        (("Deck", "front", "mcq"), "wFBZB$yWe1"),
        (("Deck", "front", "input"), "z|j7;,y!Bo"),
        (("A__B", "C", "basic"), "NOYHfbqZT_"),
        (("日本語デッキ", "問題", "cloze"), "BLt3{`}uU-"),
        (("Deck with spaces", '<p id="x" dir="auto">hi</p>', "basic"), "OpGJrh#S-H"),
        ((12345, "num", "basic"), "vF},bMi^9Q"),
    ]

    def test_vectors_match_pinned_guids(self):
        from helpers.guid import guid_for

        for args, expected in self.VECTORS:
            assert guid_for(*args) == expected, args


class TestContentGuidCollisionForking:
    """Content-formula guid (#4424): two cards with the same front + type
    collapse onto one Anki note by default, since the formula never looks at
    the back. When the backs genuinely differ that silently drops real
    content, so the second-and-later distinct back forks onto its own guid;
    a back that repeats one already seen still collapses on purpose.
    """

    def test_same_front_different_backs_get_distinct_guids(self):
        deck_info = _deck_info_cards(
            "Deck", [("What is H2O?", "Water"), ("What is H2O?", "Hydrogen peroxide")]
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_in_order(deck_info, tmpdir, "fork")
        assert len(guids) == 2
        assert guids[0] != guids[1]

    def test_same_front_same_back_still_collapse_onto_one_guid(self):
        from helpers.guid import guid_for

        deck_info = _deck_info_cards(
            "Deck", [("What is H2O?", "Water"), ("What is H2O?", "Water")]
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_in_order(deck_info, tmpdir, "collapse")
        assert guids == [guid_for("Deck", "What is H2O?", "basic")] * 2

    def test_repeated_back_reuses_its_own_guid_not_the_first_fork(self):
        # card 3 repeats card 1's back exactly, but card 2 forked in between
        # with a different back — card 3 must rejoin card 1, not card 2.
        deck_info = _deck_info_cards(
            "Deck",
            [
                ("What is H2O?", "Water"),
                ("What is H2O?", "Hydrogen peroxide"),
                ("What is H2O?", "Water"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_in_order(deck_info, tmpdir, "rejoin")
        assert guids[0] == guids[2]
        assert guids[0] != guids[1]

    def test_distinct_backs_take_ordinals_one_two_three_by_value(self):
        from helpers.guid import guid_for

        deck_info = _deck_info_cards(
            "Deck",
            [
                ("What is H2O?", "Water"),
                ("What is H2O?", "Hydrogen peroxide"),
                ("What is H2O?", "Ice"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_in_order(deck_info, tmpdir, "ordinals")
        assert guids == [
            guid_for("Deck", "What is H2O?", "basic"),
            guid_for("Deck", "What is H2O?", "basic", 2),
            guid_for("Deck", "What is H2O?", "basic", 3),
        ]

    def test_forked_guid_is_document_order_deterministic_across_runs(self):
        deck_info = _deck_info_cards(
            "Deck",
            [
                ("What is H2O?", "Water"),
                ("What is H2O?", "Hydrogen peroxide"),
                ("What is H2O?", "Ice"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids_first = _build_and_get_guids_in_order(deck_info, tmpdir, "first")
            guids_second = _build_and_get_guids_in_order(deck_info, tmpdir, "second")
        assert guids_first == guids_second
        assert len(set(guids_first)) == 3

    def test_fork_is_scoped_per_deck(self):
        # Two decks, each with its own single, unforked card (no collision in
        # either) — same front and same back, different deck name. This only
        # holds because the content formula already keys on deck name; it
        # would pass even if forking did not exist, so it's a sanity check on
        # the pre-existing keying, not on forking itself.
        deck_a = _deck_info_cards("Deck A", [("Q", "Back")])
        deck_b = _deck_info_cards("Deck B", [("Q", "Back")])
        with tempfile.TemporaryDirectory() as tmpdir:
            guids_a = _build_and_get_guids_in_order(deck_a, tmpdir, "a")
            guids_b = _build_and_get_guids_in_order(deck_b, tmpdir, "b")
        assert guids_a != guids_b

    def test_forking_does_not_cross_decks(self):
        # Each deck has its own two-distinct-back collision (its own fork).
        # A bug that hashed the ordinal without deck_name could make the two
        # decks' ordinal-2 forks collide with each other.
        deck_a = _deck_info_cards(
            "Deck A", [("Q", "Back one"), ("Q", "Back two")]
        )
        deck_b = _deck_info_cards(
            "Deck B", [("Q", "Back one"), ("Q", "Back two")]
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids_a = _build_and_get_guids_in_order(deck_a, tmpdir, "a")
            guids_b = _build_and_get_guids_in_order(deck_b, tmpdir, "b")
        assert guids_a[1] != guids_b[1]

    def test_repeat_rejoins_a_middle_fork_not_the_most_recent_one(self):
        # backs in order A, B, A, C, B — the two repeats (index 2 -> A,
        # index 4 -> B) must each rejoin the guid their own back first got,
        # not whichever fork happened to be assigned most recently.
        deck_info = _deck_info_cards(
            "Deck",
            [
                ("Q", "A"),
                ("Q", "B"),
                ("Q", "A"),
                ("Q", "C"),
                ("Q", "B"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_in_order(deck_info, tmpdir, "rejoin-middle")
        assert guids[2] == guids[0]
        assert guids[4] == guids[1]
        assert len({guids[0], guids[1], guids[3]}) == 3

    def test_fork_does_not_collide_with_a_front_that_looks_like_one(self):
        # A card whose real front already ends in the ordinal-fork's own
        # separator must not land on the same guid as an unrelated card's
        # fork. Regression for an earlier version that glued the ordinal
        # onto guid_value as text ("front::2") instead of hashing it as its
        # own value — "std::vector::2" is a plausible real front for a
        # programming deck, not a contrived string.
        deck_info = _deck_info_cards(
            "Deck",
            [
                ("std::vector", "First answer"),
                ("std::vector", "A different answer"),
                ("std::vector::2", "Unrelated card, unrelated answer"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_in_order(deck_info, tmpdir, "lookalike")
        assert len(set(guids)) == 3


def _upload_deck(deck_name: str, cards: list) -> list:
    return [
        {
            "id": abs(hash(deck_name)) % (10**10),
            "name": deck_name,
            "useContentGuid": True,
            "cards": [
                {
                    "name": card["front"],
                    "back": card["back"],
                    "number": index,
                    "tags": [],
                    "media": [],
                    "cloze": card.get("cloze", False),
                    "enableInput": False,
                    "notionId": card["block"],
                    **({"guid": card["guid"]} if "guid" in card else {}),
                }
                for index, card in enumerate(cards)
            ],
            "settings": {},
        }
    ]


def _build_and_get_guids_by_block(deck_info: list, tmpdir: str, suffix: str) -> dict:
    run_dir = os.path.join(tmpdir, suffix)
    os.makedirs(run_dir)
    _build_and_get_guids(deck_info, run_dir, suffix)
    records = json.loads(Path(run_dir, "guids.json").read_text())
    return {record["notionId"]: record["guid"] for record in records}


class TestContentGuidAvoidsLedgerGuids:
    """A card pinned from the owner's ledger (#5408) never goes through the
    content formula, so a new block with the same front used to compute the
    pinned card's exact guid and merge into it in Anki, even with a different
    back. A computed guid now steps past a pinned guid whose back differs.
    """

    DECK = "Deck"
    FRONT = "What is H2O?"

    def _pinned(self, back="Water", ordinal=1, block="block-a"):
        from helpers.guid import guid_for

        args = (self.DECK, self.FRONT, "basic") + ((ordinal,) if ordinal > 1 else ())
        return {"front": self.FRONT, "back": back, "block": block, "guid": guid_for(*args)}

    def _new(self, back, block):
        return {"front": self.FRONT, "back": back, "block": block}

    def test_new_card_after_a_pinned_one_takes_the_next_ordinal(self):
        from helpers.guid import guid_for

        deck_info = _upload_deck(
            self.DECK, [self._pinned(), self._new("Hydrogen peroxide", "block-b")]
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "after")
        assert guids == {
            "block-a": guid_for(self.DECK, self.FRONT, "basic"),
            "block-b": guid_for(self.DECK, self.FRONT, "basic", 2),
        }

    def test_new_card_before_a_pinned_one_takes_the_next_ordinal(self):
        from helpers.guid import guid_for

        deck_info = _upload_deck(
            self.DECK, [self._new("Hydrogen peroxide", "block-b"), self._pinned()]
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "before")
        assert guids == {
            "block-a": guid_for(self.DECK, self.FRONT, "basic"),
            "block-b": guid_for(self.DECK, self.FRONT, "basic", 2),
        }

    def test_new_card_with_the_pinned_back_still_collapses_onto_it(self):
        from helpers.guid import guid_for

        deck_info = _upload_deck(self.DECK, [self._pinned(), self._new("Water", "block-b")])
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "collapse")
        assert guids == {
            "block-a": guid_for(self.DECK, self.FRONT, "basic"),
            "block-b": guid_for(self.DECK, self.FRONT, "basic"),
        }

    def test_two_new_cards_beside_a_pinned_one_each_get_their_own_guid(self):
        from helpers.guid import guid_for

        deck_info = _upload_deck(
            self.DECK,
            [
                self._new("Hydrogen peroxide", "block-b"),
                self._pinned(),
                self._new("Ice", "block-c"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "two-new")
        assert guids == {
            "block-a": guid_for(self.DECK, self.FRONT, "basic"),
            "block-b": guid_for(self.DECK, self.FRONT, "basic", 2),
            "block-c": guid_for(self.DECK, self.FRONT, "basic", 3),
        }

    def test_new_card_skips_every_pinned_ordinal_already_taken(self):
        from helpers.guid import guid_for

        deck_info = _upload_deck(
            self.DECK,
            [
                self._pinned(),
                self._pinned(back="Ice", ordinal=2, block="block-c"),
                self._new("Hydrogen peroxide", "block-b"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "taken")
        assert guids["block-b"] == guid_for(self.DECK, self.FRONT, "basic", 3)

    def test_new_card_rejoins_a_pinned_fork_with_its_back(self):
        from helpers.guid import guid_for

        deck_info = _upload_deck(
            self.DECK,
            [
                self._pinned(),
                self._pinned(back="Ice", ordinal=2, block="block-c"),
                self._new("Ice", "block-b"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "rejoin")
        assert guids["block-b"] == guid_for(self.DECK, self.FRONT, "basic", 2)

    def test_cloze_card_steps_past_a_pinned_cloze_guid(self):
        from helpers.guid import guid_for

        front = "{{c1::Water}} is H2O"
        pinned = {
            "front": front,
            "back": "first",
            "block": "block-a",
            "guid": guid_for(self.DECK, front, "cloze"),
            "cloze": True,
        }
        new = {"front": front, "back": "second", "block": "block-b", "cloze": True}
        deck_info = _upload_deck(self.DECK, [pinned, new])
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "cloze")
        assert guids["block-b"] == guid_for(self.DECK, front, "cloze", 2)

    def test_pinned_guid_of_another_card_type_does_not_move_the_new_card(self):
        from helpers.guid import guid_for

        deck_info = _upload_deck(
            self.DECK,
            [
                {**self._pinned(), "guid": guid_for(self.DECK, self.FRONT, "cloze")},
                self._new("Hydrogen peroxide", "block-b"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "other-type")
        assert guids["block-b"] == guid_for(self.DECK, self.FRONT, "basic")

    def test_unrelated_pinned_guids_leave_new_cards_on_the_plain_formula(self):
        from helpers.guid import guid_for

        deck_info = _upload_deck(
            self.DECK,
            [
                {**self._pinned(), "guid": guid_for("block-a")},
                self._new("Hydrogen peroxide", "block-b"),
                self._new("Ice", "block-c"),
            ],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "unrelated")
        assert guids == {
            "block-a": guid_for("block-a"),
            "block-b": guid_for(self.DECK, self.FRONT, "basic"),
            "block-c": guid_for(self.DECK, self.FRONT, "basic", 2),
        }

    def test_second_upload_with_the_new_guids_pinned_keeps_every_guid(self):
        cards = [
            self._new("Hydrogen peroxide", "block-b"),
            self._pinned(),
            self._new("Ice", "block-c"),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            first = _build_and_get_guids_by_block(_upload_deck(self.DECK, cards), tmpdir, "first")
            replayed = [{**card, "guid": first[card["block"]]} for card in cards]
            second = _build_and_get_guids_by_block(
                _upload_deck(self.DECK, replayed), tmpdir, "second"
            )
            reordered = _build_and_get_guids_by_block(
                _upload_deck(self.DECK, list(reversed(replayed))), tmpdir, "reordered"
            )
        assert second == first
        assert reordered == first

    def test_new_cards_get_the_same_guids_when_nothing_was_recorded(self):
        cards = [
            self._new("Hydrogen peroxide", "block-b"),
            self._pinned(),
            self._new("Ice", "block-c"),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            first = _build_and_get_guids_by_block(_upload_deck(self.DECK, cards), tmpdir, "first")
            second = _build_and_get_guids_by_block(_upload_deck(self.DECK, cards), tmpdir, "second")
        assert second == first

    def test_new_card_added_later_steps_past_every_recorded_guid(self):
        from helpers.guid import guid_for

        first_cards = [self._pinned(), self._new("Hydrogen peroxide", "block-b")]
        with tempfile.TemporaryDirectory() as tmpdir:
            first = _build_and_get_guids_by_block(
                _upload_deck(self.DECK, first_cards), tmpdir, "first"
            )
            replayed = [{**card, "guid": first[card["block"]]} for card in first_cards]
            second = _build_and_get_guids_by_block(
                _upload_deck(self.DECK, [self._new("Ice", "block-c")] + replayed),
                tmpdir,
                "second",
            )
        assert second == {**first, "block-c": guid_for(self.DECK, self.FRONT, "basic", 3)}

    def test_new_card_in_a_sub_deck_steps_past_a_pinned_guid_there(self):
        from helpers.guid import guid_for

        sub_deck = "Deck::Sub"
        pinned = {
            "front": self.FRONT,
            "back": "Water",
            "block": "block-a",
            "guid": guid_for(sub_deck, self.FRONT, "basic"),
        }
        deck_info = _upload_deck(self.DECK, [self._new("Water", "block-p")]) + _upload_deck(
            sub_deck, [pinned, self._new("Hydrogen peroxide", "block-b")]
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            guids = _build_and_get_guids_by_block(deck_info, tmpdir, "sub-deck")
        assert guids == {
            "block-p": guid_for(self.DECK, self.FRONT, "basic"),
            "block-a": guid_for(sub_deck, self.FRONT, "basic"),
            "block-b": guid_for(sub_deck, self.FRONT, "basic", 2),
        }


def _assign_content_guids(cards: list) -> tuple:
    data = [{"name": "Deck", "cards": cards}]
    started = time.perf_counter()
    pinned_backs = _mod._pinned_backs_by_guid(data)
    seen = {}
    guids = [
        card["guid"]
        if "guid" in card
        else _mod._content_guid(("Deck", card["name"], "basic"), card["back"], seen, pinned_backs)
        for card in cards
    ]
    return guids, time.perf_counter() - started


class TestContentGuidAssignmentScales:
    """Thousands of cards under one front must not make guid assignment
    quadratic: it runs on every upload conversion.
    """

    def test_four_thousand_same_front_cards_are_assigned_quickly(self):
        from helpers.guid import guid_for

        cards = [{"name": "Same", "back": "back %d" % i} for i in range(4000)]
        guids, elapsed = _assign_content_guids(cards)
        assert elapsed < 2
        assert len(set(guids)) == 4000
        assert guids[:2] == [guid_for("Deck", "Same", "basic"), guid_for("Deck", "Same", "basic", 2)]
        assert guids[-1] == guid_for("Deck", "Same", "basic", 4000)

    def test_two_thousand_new_cards_beside_two_thousand_pins_are_assigned_quickly(self):
        from helpers.guid import guid_for

        new = [{"name": "Same", "back": "new %d" % i} for i in range(2000)]
        pins = [
            {
                "name": "Same",
                "back": "pinned %d" % i,
                "guid": guid_for("Deck", "Same", "basic", *([i + 1] if i else [])),
            }
            for i in range(2000)
        ]
        guids, elapsed = _assign_content_guids(new + pins)
        assert elapsed < 2
        assert len(set(guids)) == 4000
        assert guids[0] == guid_for("Deck", "Same", "basic", 2001)
        assert guids[1999] == guid_for("Deck", "Same", "basic", 4000)
