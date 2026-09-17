"""Tests for the stable field/template id and originalId hook in N2AModel."""
from genanki import Model

from helpers.n2a_model import N2AModel, NOTETYPE_MOD, stable_entry_id


def _build_json():
    model = N2AModel(
        2020,
        "n2a-basic",
        fields=[{"name": "Front", "id": 4174627053284}, {"name": "Back"}],
        templates=[
            {"name": "n2a-basic", "qfmt": "{{Front}}", "afmt": "{{FrontSide}}{{Back}}"}
        ],
        css="",
        model_type=Model.FRONT_BACK,
    )
    return model.to_json(1_700_000_000, 1)


def test_stable_entry_id_is_deterministic_and_positive():
    first = stable_entry_id("n2a-basic", "Front")
    again = stable_entry_id("n2a-basic", "Front")
    assert first == again
    assert 0 < first < 10 ** 13


def test_stable_entry_id_differs_by_notetype_and_by_entry():
    assert stable_entry_id("n2a-basic", "Front") != stable_entry_id("n2a-input", "Front")
    assert stable_entry_id("n2a-basic", "Front") != stable_entry_id("n2a-basic", "Back")


def test_to_json_keeps_explicit_field_id_and_derives_missing_one():
    data = _build_json()
    assert data["flds"][0]["id"] == 4174627053284
    assert data["flds"][1]["id"] == stable_entry_id("n2a-basic", "Back")


def test_to_json_sets_template_id():
    data = _build_json()
    assert data["tmpls"][0]["id"] == stable_entry_id("n2a-basic", "n2a-basic")


def test_to_json_sets_original_id_to_notetype_id():
    data = _build_json()
    assert data["originalId"] == 2020


def test_to_json_pins_notetype_mod_to_the_shared_constant():
    data = _build_json()
    assert data["mod"] == NOTETYPE_MOD
    # The export timestamp passed to to_json must not leak through -- that
    # would put re-uploads back to "always newer than the user's edits".
    assert data["mod"] != 1_700_000_000


def test_to_json_pins_the_same_mod_across_different_export_timestamps():
    model = N2AModel(
        2020,
        "n2a-basic",
        fields=[{"name": "Front"}, {"name": "Back"}],
        templates=[
            {"name": "n2a-basic", "qfmt": "{{Front}}", "afmt": "{{FrontSide}}{{Back}}"}
        ],
        css="",
        model_type=Model.FRONT_BACK,
    )
    first = model.to_json(1_600_000_000, 1)
    second = model.to_json(1_800_000_000, 1)
    assert first["mod"] == second["mod"] == NOTETYPE_MOD
