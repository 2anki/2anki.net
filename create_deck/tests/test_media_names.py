import contextlib
import io
import json
import os
import shutil
import sqlite3
import tempfile
import zipfile

import pytest
from anki.collection import Collection

import create_io_deck
from helpers.media_names import anki_stored_names, is_accepted, is_plain_name
from helpers.n2a_model import N2AModel
from helpers.n2a_note import N2ANote
from helpers.write_apkg import _write_new_apkg, export_package

BASIC = N2AModel(
    1607392319,
    "Test Model",
    fields=[{"name": "Question"}, {"name": "Answer"}, {"name": "MyMedia"}],
    templates=[
        {
            "name": "Card 1",
            "qfmt": "{{Question}}",
            "afmt": '{{FrontSide}}<hr id="answer">{{Answer}}',
        }
    ],
)

LONG_ASCII = "a" * 117 + ".png"
LONG_CJK = "漢" * 45 + ".png"


def _note(front, back="", my_media=""):
    return N2ANote(BASIC, fields=[front, back, my_media])


def _build(notes, files):
    workdir = tempfile.mkdtemp()
    entries = []
    for name, data in files:
        source = os.path.join(workdir, f"source-{len(entries)}.bin")
        with open(source, "wb") as handle:
            handle.write(data)
        entries.append({"path": source, "name": name})
    previous = os.getcwd()
    os.chdir(workdir)
    try:
        with contextlib.redirect_stdout(io.StringIO()) as out:
            _write_new_apkg([{"id": 1, "name": "Deck", "desc": "", "notes": notes}], entries)
    finally:
        os.chdir(previous)
    return out.getvalue().strip()


def _media(apkg_path):
    with zipfile.ZipFile(apkg_path) as archive:
        index = json.loads(archive.read("media"))
        return {name: archive.read(key) for key, name in index.items()}


def _fields(apkg_path):
    with zipfile.ZipFile(apkg_path) as archive:
        db_bytes = archive.read("collection.anki21")
    with tempfile.NamedTemporaryFile(suffix=".anki21", delete=False) as tmp:
        tmp.write(db_bytes)
    rows = sqlite3.connect(tmp.name).execute("select flds from notes order by id").fetchall()
    return [row[0].split("\x1f") for row in rows]


@pytest.mark.parametrize(
    ("label", "name", "expected"),
    [
        ("colon", "a:b.png", "ab.png"),
        ("question mark", "what?.png", "what.png"),
        ("brackets", "image[1].png", "image1.png"),
        ("angle brackets", "a<b>.png", "ab.png"),
        ("asterisk", "a*b.png", "ab.png"),
        ("pipe", "a|b.png", "ab.png"),
        ("caret", "a^b.png", "ab.png"),
        ("control character", "a\x01b.png", "ab.png"),
        ("windows reserved name", "con.png", "con_.png"),
        ("trailing dot", "name.", "name._"),
        ("trailing space", "name ", "name _"),
    ],
)
def test_a_name_anki_would_refuse_is_renamed_and_the_card_points_at_it(label, name, expected):
    apkg = _build([_note(f'<img src="{name}">', "", name)], [(name, b"bytes")])

    assert _media(apkg) == {expected: b"bytes"}, label
    assert _fields(apkg) == [[f'<img src="{expected}">', "", expected]], label


@pytest.mark.parametrize("name", [LONG_ASCII, LONG_CJK, "x." + "p" * 130])
def test_an_over_long_name_is_shortened_to_what_anki_stores(name):
    apkg = _build([_note(f'<img src="{name}">')], [(name, b"bytes")])

    [(stored, data)] = _media(apkg).items()
    assert data == b"bytes"
    assert len(stored.encode("utf-8")) <= 120
    assert _fields(apkg)[0][0] == f'<img src="{stored}">'


def test_a_name_with_nothing_anki_keeps_still_gets_a_file_and_a_reference():
    apkg = _build([_note('<img src="???.png">'), _note('<img src="[]">')], [("???.png", b"one"), ("[]", b"two")])

    media = _media(apkg)
    assert sorted(media.values()) == [b"one", b"two"]
    by_bytes = {data: stored for stored, data in media.items()}
    assert _fields(apkg) == [
        [f'<img src="{by_bytes[b"one"]}">', "", ""],
        [f'<img src="{by_bytes[b"two"]}">', "", ""],
    ]


@pytest.mark.parametrize(
    ("label", "field", "expected"),
    [
        ("double quoted", '<img src="a:b.png">', '<img src="ab.png">'),
        ("single quoted", "<img src='a:b.png'>", "<img src='ab.png'>"),
        ("unquoted", "<img src=a:b.png>", '<img src="ab.png">'),
        ("unquoted self-closing", "<img src=a:b.png/>", '<img src="ab.png"/>'),
        ("other attributes first", '<img alt="x" class="y" src="a:b.png" />', '<img alt="x" class="y" src="ab.png" />'),
        ("sound tag", "[sound:a:b.png]", "[sound:ab.png]"),
        ("audio element", '<audio src="a:b.png"></audio>', '<audio src="ab.png"></audio>'),
        ("object data", '<object data="a:b.png"></object>', '<object data="ab.png"></object>'),
        ("text that only mentions the name", "see a:b.png", "see a:b.png"),
    ],
)
def test_every_reference_form_follows_the_rename(label, field, expected):
    apkg = _build([_note(field)], [("a:b.png", b"bytes")])

    assert _fields(apkg)[0][0] == expected, label


def test_an_html_escaped_reference_follows_the_rename():
    name = 'say "hi" & wave.png'
    field = '<img src="say &quot;hi&quot; &amp; wave.png">'

    apkg = _build([_note(field)], [(name, b"bytes")])

    assert _media(apkg) == {"say hi & wave.png": b"bytes"}
    assert _fields(apkg)[0][0] == '<img src="say hi &amp; wave.png">'


def test_a_sound_tag_for_a_name_with_brackets_follows_the_rename():
    apkg = _build([_note("[sound:word[1].mp3]")], [("word[1].mp3", b"mp3")])

    assert _media(apkg) == {"word1.mp3": b"mp3"}
    assert _fields(apkg)[0][0] == "[sound:word1.mp3]"


def test_two_names_that_differ_only_in_a_refused_character_keep_their_own_files():
    notes = [_note('<img src="a:b.png">'), _note('<img src="a?b.png">')]

    apkg = _build(notes, [("a:b.png", b"first"), ("a?b.png", b"second")])

    media = _media(apkg)
    assert sorted(media.values()) == [b"first", b"second"]
    by_bytes = {data: stored for stored, data in media.items()}
    assert by_bytes[b"first"] == "ab.png"
    assert _fields(apkg) == [
        ['<img src="ab.png">', "", ""],
        [f'<img src="{by_bytes[b"second"]}">', "", ""],
    ]


def test_the_collision_name_is_the_same_on_every_build():
    notes = [_note('<img src="a:b.png"><img src="a?b.png">')]
    files = [("a:b.png", b"first"), ("a?b.png", b"second")]

    assert sorted(_media(_build(notes, files))) == sorted(_media(_build(notes, files)))


def test_an_accepted_name_keeps_its_name_when_a_refused_name_would_take_it():
    notes = [_note('<img src="a:b.png">'), _note('<img src="ab.png">')]

    apkg = _build(notes, [("a:b.png", b"renamed"), ("ab.png", b"accepted")])

    media = _media(apkg)
    assert media["ab.png"] == b"accepted"
    by_bytes = {data: stored for stored, data in media.items()}
    assert by_bytes[b"renamed"] != "ab.png"
    assert _fields(apkg) == [
        [f'<img src="{by_bytes[b"renamed"]}">', "", ""],
        ['<img src="ab.png">', "", ""],
    ]


@pytest.mark.parametrize(
    "name",
    [
        "diagram.png",
        "0" * 100 + ".png",
        "café.png",
        "two words.png",
        "a%20b.png",
        "a#b.png",
        "A.PNG",
        "a" * 116 + ".png",
        "folderA_image.png",
        "My Notes_Photo 1.JPG",
    ],
)
def test_an_accepted_name_is_left_exactly_as_it_was(name):
    field = f'<img src="{name}">'

    apkg = _build([_note(field, "", name)], [(name, b"bytes")])

    assert _media(apkg) == {name: b"bytes"}
    assert _fields(apkg) == [[field, "", name]]


@pytest.mark.parametrize(
    ("label", "name", "stored"),
    [
        ("refused characters", 'a[b]c<d>e:f"g/h?i*j^k\\l|m.png', "abcdefghijklm.png"),
        ("control characters", "a\x00\x1f\x7fb.png", "ab.png"),
        ("tab", "a\tb.png", "ab.png"),
        ("windows device name", "nul.txt", "nul_.txt"),
        ("windows device name without extension", "con", "con_"),
        ("windows device name with a digit", "com1.jpg", "com1_.jpg"),
        ("trailing dot", "name.", "name._"),
        ("trailing space", "name ", "name _"),
        ("decomposed accent", "café.png", "café.png"),
        ("non-breaking space", "a b.png", "a b.png"),
        ("121 bytes", "a" * 117 + ".png", "a" * 115 + ".png"),
        ("120 bytes", "a" * 116 + ".png", "a" * 116 + ".png"),
        ("long extension", "x." + "p" * 130, "x." + "p" * 10),
        ("accepted punctuation", "a%20b#c&d'e;f{g}.png", "a%20b#c&d'e;f{g}.png"),
        ("leading space and dot", " .hidden.png", " .hidden.png"),
        ("emoji", "\U0001F600.png", "\U0001F600.png"),
        ("nothing left", "???", None),
    ],
)
def test_anki_stores_names_by_this_rule(label, name, stored):
    assert anki_stored_names([name]) == {name: stored}, label


@pytest.mark.parametrize(
    "name",
    ["0" * 100 + ".png", "folderA_image.png", "a-b.c_d.png", "a" * 116 + ".png", "IMG_0001.JPG"],
)
def test_a_plain_name_skips_the_probe_because_anki_accepts_it(name):
    assert is_plain_name(name)
    assert is_accepted(name, anki_stored_names([name])[name])


@pytest.mark.parametrize(
    ("name", "accepted"),
    [
        ("Foo.png", True),
        ("My Photo.PNG", True),
        ("CAFÉ.png", True),
        ("Con.png", False),
        ("A:B.png", False),
        ("CAFÉ.png", False),
    ],
)
def test_case_alone_never_makes_a_name_refused(name, accepted):
    assert is_accepted(name, anki_stored_names([name])[name]) is accepted


@pytest.mark.parametrize(
    "name",
    ["con.png", "Nul", "lpt1.txt", "a" * 117 + ".png", "name.", ".hidden", "a..png", "two words.png", "a:b.png"],
)
def test_a_name_that_might_change_is_not_plain(name):
    assert not is_plain_name(name)


def test_an_image_occlusion_upload_named_by_the_user_ships_under_a_name_anki_accepts():
    workdir = tempfile.mkdtemp()
    image = os.path.join(workdir, "scan [page 1]: heart?.png")
    with open(image, "wb") as handle:
        handle.write(b"scan")
    media_files = []
    rect = {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}
    notes = create_io_deck.build_io_notes({"imageName": image, "rects": [rect]}, False, media_files)
    previous = os.getcwd()
    os.chdir(workdir)
    try:
        with contextlib.redirect_stdout(io.StringIO()) as out:
            _write_new_apkg([{"id": 1, "name": "IO", "desc": "", "notes": notes}], media_files)
    finally:
        os.chdir(previous)
    apkg = out.getvalue().strip()

    assert _media(apkg) == {"scan page 1 heart.png": b"scan"}
    assert _fields(apkg)[0][1] == '<img src="scan page 1 heart.png">'


def test_an_export_that_still_refuses_media_runs_ankis_media_check_and_retries(capsys):
    workdir = tempfile.mkdtemp()
    collection = Collection(os.path.join(workdir, "collection.anki2"))
    try:
        note = collection.new_note(collection.models.by_name("Basic"))
        note["Front"] = '<img src="secret:name.png">'
        collection.add_note(note, 1)
        collection.db.execute("update notes set mod = ? where id = ?", 1_600_000_000, note.id)
        with open(os.path.join(collection.media.dir(), "secret:name.png"), "wb") as handle:
            handle.write(b"bytes")
        out_path = os.path.join(workdir, "out.apkg")

        export_package(collection, out_path, [(1_600_000_000, note.id)])

        assert collection.db.scalar("select mod from notes where id = ?", note.id) == 1_600_000_000
    finally:
        collection.close()

    assert _media(out_path) == {"secretname.png": b"bytes"}
    with zipfile.ZipFile(out_path) as archive:
        db_bytes = archive.read("collection.anki21")
    with tempfile.NamedTemporaryFile(suffix=".anki21", delete=False) as tmp:
        tmp.write(db_bytes)
    flds = sqlite3.connect(tmp.name).execute("select flds from notes").fetchone()[0]
    assert flds.split("\x1f")[0] == '<img src="secretname.png">'
    err = capsys.readouterr().err
    assert "media check renamed 1 media file(s)" in err
    assert "secret" not in err
    shutil.rmtree(workdir, ignore_errors=True)
