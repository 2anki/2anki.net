import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parents[2]
CREATE_DECK_DIR = str(REPO_ROOT / "create_deck")
if CREATE_DECK_DIR not in sys.path:
    sys.path.insert(0, CREATE_DECK_DIR)

spec = importlib.util.spec_from_file_location(
    "create_deck_module",
    str(REPO_ROOT / "create_deck" / "create_deck.py")
)
_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(_module)
build_one_deck = _module.build_one_deck

TEMPLATE_DIR = str(REPO_ROOT / "src" / "templates") + os.sep


def _mcq_deck_info(question: str, options: list, correct_index: int, extra: str = "") -> list:
    return [
        {
            "id": 123456789,
            "name": "MCQ Test Deck",
            "cards": [
                {
                    "name": question,
                    "back": extra,
                    "number": 0,
                    "tags": [],
                    "media": [],
                    "cloze": False,
                    "enableInput": False,
                    "mcq": True,
                    "options": options,
                    "correctIndices": [correct_index],
                }
            ],
            "settings": {
                "template": "specialstyle",
            },
        }
    ]


def _write_deck_info(tmpdir: str, data: list) -> str:
    path = os.path.join(tmpdir, "deck_info.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return path


class TestMCQDeckBuild:
    def test_mcq_card_produces_apkg(self):
        options = ["Aspirin", "Penicillin", "Ciprofloxacin", "Metronidazole"]
        data = _mcq_deck_info(
            "Which antibiotic targets the cell wall?",
            options,
            1,
            "Penicillin inhibits peptidoglycan cross-linking.",
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            old_cwd = os.getcwd()
            os.chdir(tmpdir)
            try:
                info_path = _write_deck_info(tmpdir, data)
                result = build_one_deck(info_path, TEMPLATE_DIR)
                assert result is not None
                assert result.endswith(".apkg")
                assert os.path.exists(result)
            finally:
                os.chdir(old_cwd)

    def test_mcq_apkg_carries_options_and_correct_answer(self):
        options = ["Lipase", "Amylase", "Protease", "Lactase"]
        data = _mcq_deck_info(
            "Which enzyme hydrolyses starch?",
            options,
            1,
            "Amylase breaks down starch.",
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            old_cwd = os.getcwd()
            os.chdir(tmpdir)
            try:
                info_path = _write_deck_info(tmpdir, data)
                result = build_one_deck(info_path, TEMPLATE_DIR)
                extract_dir = os.path.join(tmpdir, "unpacked")
                with zipfile.ZipFile(result) as archive:
                    archive.extractall(extract_dir)
                conn = sqlite3.connect(
                    os.path.join(extract_dir, "collection.anki21")
                )
                try:
                    flds = conn.execute("select flds from notes").fetchone()[0]
                    models = json.loads(
                        conn.execute("select models from col").fetchone()[0]
                    )
                finally:
                    conn.close()
                field_values = flds.split("\x1f")
                assert "Lipase<br>Amylase<br>Protease<br>Lactase" in field_values
                assert "Amylase" in field_values
                model_names = [m["name"] for m in models.values()]
                assert model_names == ["n2a-mcq"]
            finally:
                os.chdir(old_cwd)

    def test_mcq_options_joined_with_br(self):
        options = ["A", "B", "C", "D"]
        expected_options_html = "A<br>B<br>C<br>D"
        actual = "<br>".join(options)
        assert actual == expected_options_html

    def test_mcq_correct_answer_is_option_text(self):
        options = ["Aspirin", "Penicillin", "Ibuprofen", "Paracetamol"]
        correct_index = 1
        correct_answer = options[correct_index]
        assert correct_answer == "Penicillin"

    def test_mcq_card_with_four_options_succeeds(self):
        options = ["Option A", "Option B", "Option C", "Option D"]
        data = _mcq_deck_info("Which option is correct?", options, 2)
        with tempfile.TemporaryDirectory() as tmpdir:
            old_cwd = os.getcwd()
            os.chdir(tmpdir)
            try:
                info_path = _write_deck_info(tmpdir, data)
                result = build_one_deck(info_path, TEMPLATE_DIR)
                assert result is not None
            finally:
                os.chdir(old_cwd)

    def test_non_mcq_card_uses_basic_model(self):
        data = [
            {
                "id": 987654321,
                "name": "Basic Deck",
                "cards": [
                    {
                        "name": "What is 2+2?",
                        "back": "4",
                        "number": 0,
                        "tags": [],
                        "media": [],
                        "cloze": False,
                        "enableInput": False,
                        "mcq": False,
                        "options": [],
                        "correctIndices": [],
                    }
                ],
                "settings": {"template": "specialstyle"},
            }
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            old_cwd = os.getcwd()
            os.chdir(tmpdir)
            try:
                info_path = _write_deck_info(tmpdir, data)
                result = build_one_deck(info_path, TEMPLATE_DIR)
                assert result is not None
                assert result.endswith(".apkg")
            finally:
                os.chdir(old_cwd)
