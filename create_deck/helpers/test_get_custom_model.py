"""Tests for the apkg-input transform pipeline's custom-model factory."""
from anki.collection import Collection

from .get_model import get_custom_model
from .n2a_model import NOTETYPE_MOD, N2AModel


def test_keeps_user_field_names_in_order():
    model = get_custom_model("Vocab", ["Word", "Definition", "Image"], False, "")
    assert [f["name"] for f in model.fields] == ["Word", "Definition", "Image"]


def test_basic_model_first_field_drives_front():
    model = get_custom_model("Vocab", ["Word", "Definition", "Image"], False, "")
    qfmt = model.templates[0]["qfmt"]
    assert qfmt == "{{Word}}"


def test_basic_model_back_renders_remaining_fields_after_front_side():
    model = get_custom_model("Vocab", ["Word", "Definition", "Image"], False, "")
    afmt = model.templates[0]["afmt"]
    assert afmt.startswith("{{FrontSide}}")
    assert "{{Definition}}" in afmt
    assert "{{Image}}" in afmt


def test_basic_model_is_front_back_type():
    model = get_custom_model("Vocab", ["Word", "Definition"], False, "")
    assert model.model_type == N2AModel.FRONT_BACK


def test_cloze_model_wraps_first_field_as_cloze():
    model = get_custom_model("MyCloze", ["Text", "Extra"], True, "")
    qfmt = model.templates[0]["qfmt"]
    afmt = model.templates[0]["afmt"]
    assert qfmt == "{{cloze:Text}}"
    assert "{{cloze:Text}}" in afmt
    assert "{{Extra}}" in afmt
    assert model.model_type == N2AModel.CLOZE


def test_falls_back_to_front_back_when_no_field_names_given():
    model = get_custom_model("Empty", [], False, "")
    assert [f["name"] for f in model.fields] == ["Front", "Back"]


def test_css_is_passed_through_unchanged():
    css_in = ".card { background: #fafafa; }"
    model = get_custom_model("Vocab", ["A", "B"], False, css_in)
    assert model.css == css_in


def test_model_id_is_deterministic_for_the_same_name():
    a = get_custom_model("Vocab", ["A"], False, "")
    b = get_custom_model("Vocab", ["A", "B"], False, "")
    assert a.model_id == b.model_id


def test_model_id_differs_for_different_names():
    a = get_custom_model("VocabA", ["A"], False, "")
    b = get_custom_model("VocabB", ["A"], False, "")
    assert a.model_id != b.model_id


def test_single_field_basic_does_not_emit_orphan_separator():
    model = get_custom_model("Solo", ["Only"], False, "")
    afmt = model.templates[0]["afmt"]
    assert afmt == '{{FrontSide}}<hr id="answer">'


def test_custom_model_keeps_the_pinned_mod(tmp_path):
    model = get_custom_model("Vocab", ["Word", "Definition"], False, ".card { font-size: 40px; }")
    collection = Collection(str(tmp_path / "collection.anki2"))
    try:
        assert model.to_notetype_dict(collection)["mod"] == NOTETYPE_MOD
    finally:
        collection.close()
