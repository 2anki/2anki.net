"""Tests for the stable ids, originalId and pinned mod in N2AModel.to_notetype_dict."""
import pytest
from anki.collection import Collection

from helpers.n2a_model import N2AModel, NOTETYPE_MOD, stable_entry_id


@pytest.fixture(name="collection")
def collection_fixture(tmp_path):
    collection = Collection(str(tmp_path / "collection.anki2"))
    yield collection
    collection.close()


def _build(collection, **overrides):
    model = N2AModel(
        2020,
        "n2a-basic",
        fields=[{"name": "Front", "id": 4174627053284}, {"name": "Back"}],
        templates=[
            {"name": "n2a-basic", "qfmt": "{{Front}}", "afmt": "{{FrontSide}}{{Back}}"}
        ],
        css=".card { color: red; }",
        model_type=N2AModel.FRONT_BACK,
        **overrides,
    )
    return model.to_notetype_dict(collection)


def test_stable_entry_id_is_deterministic_and_positive():
    first = stable_entry_id("n2a-basic", "Front")
    again = stable_entry_id("n2a-basic", "Front")
    assert first == again
    assert 0 < first < 10 ** 13


def test_stable_entry_id_differs_by_notetype_and_by_entry():
    assert stable_entry_id("n2a-basic", "Front") != stable_entry_id("n2a-input", "Front")
    assert stable_entry_id("n2a-basic", "Front") != stable_entry_id("n2a-basic", "Back")


def test_keeps_explicit_field_id_and_derives_missing_one(collection):
    data = _build(collection)
    assert data["flds"][0]["id"] == 4174627053284
    assert data["flds"][1]["id"] == stable_entry_id("n2a-basic", "Back")


def test_sets_template_id_and_content(collection):
    template = _build(collection)["tmpls"][0]
    assert template["id"] == stable_entry_id("n2a-basic", "n2a-basic")
    assert template["qfmt"] == "{{Front}}"
    assert template["afmt"] == "{{FrontSide}}{{Back}}"


def test_sets_id_type_css_and_original_id(collection):
    data = _build(collection)
    assert data["id"] == 2020
    assert data["name"] == "n2a-basic"
    assert data["type"] == N2AModel.FRONT_BACK
    assert data["css"] == ".card { color: red; }"
    assert data["originalId"] == 2020


def test_pins_notetype_mod_to_the_shared_constant(collection):
    assert _build(collection)["mod"] == NOTETYPE_MOD


def test_copies_field_tag_and_prevent_deletion(collection):
    model = N2AModel(
        7,
        "io",
        fields=[{"name": "Occlusion", "tag": 0, "preventDeletion": True}, {"name": "Comments"}],
        templates=[{"name": "io", "qfmt": "{{cloze:Occlusion}}", "afmt": "{{cloze:Occlusion}}"}],
        model_type=N2AModel.CLOZE,
        original_stock_kind=6,
    )
    data = model.to_notetype_dict(collection)
    assert data["type"] == N2AModel.CLOZE
    assert data["originalStockKind"] == 6
    assert data["flds"][0]["tag"] == 0
    assert data["flds"][0]["preventDeletion"] is True
    assert data["flds"][1]["preventDeletion"] is False


def test_leaves_stock_kind_unset_without_one(collection):
    assert _build(collection).get("originalStockKind", 0) == 0
