import time

import create_io_deck
from helpers.get_model import get_model
from helpers.get_model_id import get_model_id

IMAGE_OCCLUSION_STOCK_KIND = 6
EXPECTED_FIELD_ORDER = ["Occlusion", "Image", "Header", "Back Extra", "Comments"]


def _io_model_json():
    model = get_model(
        (
            "io",
            create_io_deck.IO_MODEL_ID,
            create_io_deck.IO_MODEL_NAME,
            None,
            None,
            None,
        )
    )
    return model.to_json(time.time(), 1)


def test_io_notetype_is_named_distinctly_from_anki_stock():
    assert _io_model_json()["name"] == "2anki Image Occlusion"


def test_io_notetype_keeps_the_legacy_model_id_for_in_place_update():
    data = _io_model_json()
    assert data["id"] == str(get_model_id("Image Occlusion"))
    assert data["originalId"] == get_model_id("Image Occlusion")


def test_io_notetype_declares_the_image_occlusion_stock_kind():
    assert _io_model_json()["originalStockKind"] == IMAGE_OCCLUSION_STOCK_KIND


def test_io_fields_are_tagged_in_stock_order():
    fields = _io_model_json()["flds"]
    assert [field["name"] for field in fields] == EXPECTED_FIELD_ORDER
    assert [field["tag"] for field in fields] == [0, 1, 2, 3, 4]


def test_io_fields_prevent_deletion_except_comments():
    fields = _io_model_json()["flds"]
    prevent = [field.get("preventDeletion", False) for field in fields]
    assert prevent == [True, True, True, True, False]


def test_non_io_notetype_has_no_stock_kind():
    model = get_model(
        ("basic", get_model_id("n2a-basic"), "n2a-basic", None, None, None)
    )
    assert "originalStockKind" not in model.to_json(time.time(), 1)
