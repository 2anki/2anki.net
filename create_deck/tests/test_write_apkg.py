import contextlib
import io
import json
import os
import sqlite3
import tempfile
import time
import zipfile

import pytest

from helpers.n2a_model import NOTETYPE_MOD, N2AModel, stable_entry_id
from helpers.n2a_note import N2ANote
from helpers.write_apkg import _write_new_apkg, rename_temp_file, sanitize_filename

BASIC = N2AModel(
    1607392319,
    "Test Model",
    fields=[{"name": "Question"}, {"name": "Answer"}],
    templates=[
        {
            "name": "Card 1",
            "qfmt": "{{Question}}",
            "afmt": '{{FrontSide}}<hr id="answer">{{Answer}}',
        }
    ],
)

CLOZE = N2AModel(
    1607392320,
    "Test Cloze",
    fields=[{"name": "Text"}, {"name": "Extra"}],
    templates=[
        {"name": "Cloze", "qfmt": "{{cloze:Text}}", "afmt": "{{cloze:Text}}<br>{{Extra}}"}
    ],
    model_type=N2AModel.CLOZE,
)


def _deck(deck_id, name, notes):
    return {"id": deck_id, "name": name, "desc": "", "notes": notes}


def _note(front, back, **extra):
    return N2ANote(BASIC, fields=[front, back], **extra)


def _build(deck_payloads, media_files=(), workdir=None):
    workdir = workdir or tempfile.mkdtemp()
    previous = os.getcwd()
    os.chdir(workdir)
    try:
        with contextlib.redirect_stdout(io.StringIO()) as out:
            _write_new_apkg(deck_payloads, list(media_files))
    finally:
        os.chdir(previous)
    return out.getvalue().strip()


def _collection(apkg_path):
    with zipfile.ZipFile(apkg_path) as archive:
        db_bytes = archive.read("collection.anki21")
    with tempfile.NamedTemporaryFile(suffix=".anki21", delete=False) as tmp:
        tmp.write(db_bytes)
    return sqlite3.connect(tmp.name)


def _media(apkg_path):
    with zipfile.ZipFile(apkg_path) as archive:
        index = json.loads(archive.read("media"))
        return {name: archive.read(key) for key, name in index.items()}


def _models(connection):
    return json.loads(connection.execute("select models from col").fetchone()[0])


def _decks(connection):
    return json.loads(connection.execute("select decks from col").fetchone()[0])


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Hello World!", "Hello-World"),
        ("Test@#$%^&*", "Test"),
        ("Space - Dash", "Space---Dash"),
        ("emoji😀test", "emoji😀test"),
        ("", ""),
        ("../../../etc/passwd", "etcpasswd"),
        ("..\\..\\windows\\system32", "windowssystem32"),
        ("test/../danger", "testdanger"),
    ],
)
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected


def test_single_deck_writes_notes_deck_and_notetype():
    notes = [
        _note("Q1", "A1", tags=["chem", "week1"], guid="guid-one"),
        _note("Q2", "A2", guid="guid-two"),
    ]
    apkg = _build([_deck(1234567890, "Test Deck", notes)])

    assert os.path.basename(apkg) == "Test-Deck-1234567890.apkg"
    connection = _collection(apkg)
    rows = connection.execute(
        "select guid, mid, tags, flds from notes order by id"
    ).fetchall()
    assert rows == [
        ("guid-one", 1607392319, " chem week1 ", "Q1\x1fA1"),
        ("guid-two", 1607392319, "", "Q2\x1fA2"),
    ]
    assert _decks(connection)["1234567890"]["name"] == "Test Deck"
    assert connection.execute(
        "select count() from cards where did = 1234567890"
    ).fetchone()[0] == 2


def test_notetype_keeps_pinned_ids_and_mod():
    apkg = _build([_deck(1, "Deck", [_note("Q", "A")])])

    notetype = _models(_collection(apkg))["1607392319"]
    assert notetype["name"] == "Test Model"
    assert notetype["originalId"] == 1607392319
    assert notetype["mod"] == NOTETYPE_MOD
    assert [f["id"] for f in notetype["flds"]] == [
        stable_entry_id("Test Model", "Question"),
        stable_entry_id("Test Model", "Answer"),
    ]
    assert notetype["tmpls"][0]["id"] == stable_entry_id("Test Model", "Card 1")


def test_cards_are_numbered_from_one_across_decks_in_document_order():
    apkg = _build(
        [
            _deck(1001, "Parent", [_note("P1", "a"), _note("P2", "b")]),
            _deck(1002, "Parent::Child", [_note("C1", "c")]),
        ]
    )

    rows = _collection(apkg).execute(
        "select n.flds, c.due, c.did from cards c join notes n on n.id = c.nid order by c.id"
    ).fetchall()
    assert rows == [("P1\x1fa", 1, 1001), ("P2\x1fb", 2, 1001), ("C1\x1fc", 3, 1002)]


def test_cloze_note_gets_one_card_per_cloze_sharing_the_notes_position():
    notes = [
        N2ANote(CLOZE, fields=["{{c1::one}} and {{c2::two}}", ""]),
        N2ANote(CLOZE, fields=["{{c1::three}}", ""]),
    ]
    apkg = _build([_deck(1, "Deck", notes)])

    rows = _collection(apkg).execute(
        "select ord, due from cards order by nid, ord"
    ).fetchall()
    assert rows == [(0, 1), (1, 1), (0, 2)]


def test_media_referenced_by_a_note_is_packaged_under_its_basename():
    workdir = tempfile.mkdtemp()
    image = os.path.join(workdir, "diagram.png")
    sound = os.path.join(workdir, "word.mp3")
    with open(image, "wb") as handle:
        handle.write(b"png-bytes")
    with open(sound, "wb") as handle:
        handle.write(b"mp3-bytes")
    note = _note('<img src="diagram.png">', "[sound:word.mp3]")

    apkg = _build([_deck(1, "Deck", [note])], [image, sound], workdir)

    assert _media(apkg) == {"diagram.png": b"png-bytes", "word.mp3": b"mp3-bytes"}


def test_repeated_media_paths_are_packaged_once(capsys):
    workdir = tempfile.mkdtemp()
    image = os.path.join(workdir, "page.png")
    with open(image, "wb") as handle:
        handle.write(b"x")
    note = _note('<img src="page.png">', "")

    apkg = _build([_deck(1, "Deck", [note])], [image, image, "missing.png"], workdir)

    assert list(_media(apkg)) == ["page.png"]
    assert "Skipping 1 missing media file(s)" in capsys.readouterr().err


def test_note_mod_is_pinned_when_given_and_stamped_otherwise():
    before = int(time.time())
    notes = [_note("Q1", "A1", mod=1_600_000_000), _note("Q2", "A2")]
    apkg = _build([_deck(1, "Deck", notes)])

    rows = _collection(apkg).execute("select flds, mod from notes order by id").fetchall()
    assert rows[0] == ("Q1\x1fA1", 1_600_000_000)
    assert rows[1][0] == "Q2\x1fA2"
    assert rows[1][1] >= before


def test_note_with_an_empty_front_still_ships_with_one_card():
    apkg = _build([_deck(1, "Deck", [_note("", "only a back")])])

    rows = _collection(apkg).execute(
        "select n.flds, c.ord from cards c join notes n on n.id = c.nid"
    ).fetchall()
    assert rows == [("\x1fonly a back", 0)]


def test_empty_deck_list_still_writes_a_package():
    apkg = _build([])

    assert os.path.basename(apkg) == "default-.apkg"
    assert _collection(apkg).execute("select count() from notes").fetchone()[0] == 0


def test_package_uses_the_layout_older_anki_clients_read():
    apkg = _build([_deck(1, "Deck", [_note("Q", "A")])])

    with zipfile.ZipFile(apkg) as archive:
        names = set(archive.namelist())
    assert {"collection.anki21", "collection.anki2", "media"} <= names


def test_rename_temp_file_rejects_path_traversal():
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_file = os.path.join(tmpdir, "temp.apkg")
        with open(temp_file, "w", encoding="utf-8") as handle:
            handle.write("test content")
        previous = os.getcwd()
        os.chdir(tmpdir)
        try:
            for dangerous_name, dangerous_id in [
                ("../../../danger", "1234"),
                ("normal", "../../../etc/passwd"),
                ("../up", "../back"),
            ]:
                with pytest.raises(ValueError, match="Path traversal attempt detected"):
                    rename_temp_file(temp_file, dangerous_name, dangerous_id)

            result = rename_temp_file(temp_file, "safe_name", "1234")
        finally:
            os.chdir(previous)
        assert result == os.path.join(os.path.realpath(tmpdir), "safe_name-1234.apkg")
        assert os.path.exists(result)
