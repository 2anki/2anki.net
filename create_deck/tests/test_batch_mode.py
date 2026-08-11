import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import importlib.util as _ilu

_spec = _ilu.spec_from_file_location(
    "create_deck_script",
    Path(__file__).parents[1] / "create_deck.py",
)
_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
_clamp_output_path = _mod._clamp_output_path

REPO_ROOT = Path(__file__).parents[2]
SCRIPT = REPO_ROOT / "create_deck" / "create_deck.py"
TEMPLATE_DIR = str(REPO_ROOT / "src" / "templates") + os.sep
PYTHON = sys.executable


def _minimal_deck_info(deck_name: str, media_filename: str) -> list:
    return [
        {
            "id": abs(hash(deck_name)) % (10**10),
            "name": deck_name,
            "cards": [
                {
                    "name": f"<img src='{media_filename}'>",
                    "back": "back",
                    "number": 0,
                    "tags": [],
                    "media": [media_filename],
                    "cloze": False,
                    "enableInput": False,
                }
            ],
            "settings": {
                "template": "notionstyle",
            },
        }
    ]


def _write_deck_workspace(tmpdir: str, deck_name: str, media_filename: str) -> dict:
    subdir = os.path.join(tmpdir, deck_name.replace(" ", "_"))
    os.makedirs(subdir, exist_ok=True)

    deck_info_path = os.path.join(subdir, "deck_info.json")
    with open(deck_info_path, "w", encoding="utf-8") as f:
        json.dump(_minimal_deck_info(deck_name, media_filename), f)

    media_path = os.path.join(subdir, media_filename)
    with open(media_path, "wb") as f:
        f.write(b"fake-image-data-" + deck_name.encode())

    output_path = os.path.join(subdir, f"{deck_name.replace(' ', '_')}.apkg")
    return {"input": deck_info_path, "output": output_path, "subdir": subdir}


def _apkg_media_names(apkg_path: str) -> set:
    names = set()
    with zipfile.ZipFile(apkg_path) as zf:
        try:
            media_json = json.loads(zf.read("media"))
            names = set(media_json.values())
        except (KeyError, json.JSONDecodeError):
            pass
    return names


class TestBatchMode:
    def test_batch_produces_two_apkg_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            alpha = _write_deck_workspace(tmpdir, "Alpha Deck", "alpha.jpg")
            beta = _write_deck_workspace(tmpdir, "Beta Deck", "beta.jpg")

            manifest_path = os.path.join(tmpdir, "manifest.json")
            with open(manifest_path, "w") as f:
                json.dump(
                    [
                        {"input": alpha["input"], "output": alpha["output"]},
                        {"input": beta["input"], "output": beta["output"]},
                    ],
                    f,
                )

            result = subprocess.run(
                [PYTHON, str(SCRIPT), "--batch", manifest_path, str(TEMPLATE_DIR)],
                capture_output=True,
                text=True,
                cwd=alpha["subdir"],
            )
            assert result.returncode == 0, f"stderr: {result.stderr}"
            assert os.path.exists(alpha["output"]), "alpha apkg missing"
            assert os.path.exists(beta["output"]), "beta apkg missing"

    def test_batch_stdout_lists_output_paths(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            alpha = _write_deck_workspace(tmpdir, "Alpha Deck", "alpha.jpg")
            beta = _write_deck_workspace(tmpdir, "Beta Deck", "beta.jpg")

            manifest_path = os.path.join(tmpdir, "manifest.json")
            with open(manifest_path, "w") as f:
                json.dump(
                    [
                        {"input": alpha["input"], "output": alpha["output"]},
                        {"input": beta["input"], "output": beta["output"]},
                    ],
                    f,
                )

            result = subprocess.run(
                [PYTHON, str(SCRIPT), "--batch", manifest_path, str(TEMPLATE_DIR)],
                capture_output=True,
                text=True,
                cwd=alpha["subdir"],
            )
            assert result.returncode == 0, f"stderr: {result.stderr}"
            lines = [l for l in result.stdout.strip().splitlines() if l.strip()]
            assert alpha["output"] in lines
            assert beta["output"] in lines

    def test_no_media_cross_pollination_between_decks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            alpha = _write_deck_workspace(tmpdir, "Alpha Deck", "alpha.jpg")
            beta = _write_deck_workspace(tmpdir, "Beta Deck", "beta.jpg")

            manifest_path = os.path.join(tmpdir, "manifest.json")
            with open(manifest_path, "w") as f:
                json.dump(
                    [
                        {"input": alpha["input"], "output": alpha["output"]},
                        {"input": beta["input"], "output": beta["output"]},
                    ],
                    f,
                )

            result = subprocess.run(
                [PYTHON, str(SCRIPT), "--batch", manifest_path, str(TEMPLATE_DIR)],
                capture_output=True,
                text=True,
                cwd=alpha["subdir"],
            )
            assert result.returncode == 0, f"stderr: {result.stderr}"

            alpha_media = _apkg_media_names(alpha["output"])
            beta_media = _apkg_media_names(beta["output"])

            assert "alpha.jpg" in alpha_media, f"alpha.jpg missing from alpha deck; got {alpha_media}"
            assert "beta.jpg" in beta_media, f"beta.jpg missing from beta deck; got {beta_media}"
            assert "beta.jpg" not in alpha_media, f"beta.jpg leaked into alpha deck"
            assert "alpha.jpg" not in beta_media, f"alpha.jpg leaked into beta deck"

    def test_batch_failure_surfaces_input_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = os.path.join(tmpdir, "manifest.json")
            with open(manifest_path, "w") as f:
                json.dump(
                    [{"input": "/nonexistent/deck_info.json", "output": "/tmp/out.apkg"}],
                    f,
                )

            result = subprocess.run(
                [PYTHON, str(SCRIPT), "--batch", manifest_path, str(TEMPLATE_DIR)],
                capture_output=True,
                text=True,
                cwd=tmpdir,
            )
            assert result.returncode == 0
            assert "nonexistent" in result.stderr
            assert result.stdout.strip() == ""

    def test_batch_continues_past_failing_entry(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            good = _write_deck_workspace(tmpdir, "Good Deck", "good.jpg")

            manifest_path = os.path.join(tmpdir, "manifest.json")
            with open(manifest_path, "w") as f:
                json.dump(
                    [
                        {
                            "input": "/nonexistent/deck_info.json",
                            "output": "/tmp/out.apkg",
                        },
                        {"input": good["input"], "output": good["output"]},
                    ],
                    f,
                )

            result = subprocess.run(
                [PYTHON, str(SCRIPT), "--batch", manifest_path, str(TEMPLATE_DIR)],
                capture_output=True,
                text=True,
                cwd=good["subdir"],
            )
            assert result.returncode == 0, f"stderr: {result.stderr}"
            assert os.path.exists(good["output"]), "good apkg missing"
            assert good["output"] in result.stdout
            assert "nonexistent" in result.stderr

    def test_empty_deck_in_batch_exits_cleanly(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "empty")
            os.makedirs(subdir)
            deck_info_path = os.path.join(subdir, "deck_info.json")
            with open(deck_info_path, "w") as f:
                json.dump([], f)
            output_path = os.path.join(subdir, "out.apkg")

            manifest_path = os.path.join(tmpdir, "manifest.json")
            with open(manifest_path, "w") as f:
                json.dump([{"input": deck_info_path, "output": output_path}], f)

            result = subprocess.run(
                [PYTHON, str(SCRIPT), "--batch", manifest_path, str(TEMPLATE_DIR)],
                capture_output=True,
                text=True,
                cwd=subdir,
            )
            assert result.returncode == 0


class TestClampOutputPath:
    def test_short_path_is_unchanged(self):
        path = "/tmp/short.apkg"
        assert _clamp_output_path(path) == path

    def test_long_ascii_basename_is_truncated(self):
        long_stem = "a" * 300
        path = f"/tmp/{long_stem}.apkg"
        result = _clamp_output_path(path)
        assert result.endswith(".apkg")
        assert len(os.path.basename(result).encode("utf-8")) <= 200

    def test_long_german_basename_does_not_split_codepoint(self):
        long_stem = "ä" * 150
        path = f"/tmp/{long_stem}.apkg"
        result = _clamp_output_path(path)
        assert result.endswith(".apkg")
        basename = os.path.basename(result)
        assert len(basename.encode("utf-8")) <= 200
        assert "ä" in basename
        assert "�" not in basename

    def test_directory_is_preserved_after_truncation(self):
        long_stem = "x" * 300
        path = f"/some/deep/dir/{long_stem}.apkg"
        result = _clamp_output_path(path)
        assert os.path.dirname(result) == "/some/deep/dir"

    def test_exact_200_byte_basename_is_unchanged(self):
        stem = "a" * 195
        path = f"/tmp/{stem}.apkg"
        assert len(os.path.basename(path).encode("utf-8")) == 200
        assert _clamp_output_path(path) == path


class TestBatchLongFilename:
    def test_batch_succeeds_with_over_255_byte_output_path(self):
        long_name = "Engramm" + ("ä" * 130)
        with tempfile.TemporaryDirectory() as tmpdir:
            entry = _write_deck_workspace(tmpdir, "Engramm", "card.jpg")
            long_output = os.path.join(tmpdir, f"{long_name}.apkg")
            assert len(os.path.basename(long_output).encode("utf-8")) > 255

            manifest_path = os.path.join(tmpdir, "manifest.json")
            with open(manifest_path, "w") as f:
                json.dump([{"input": entry["input"], "output": long_output}], f)

            result = subprocess.run(
                [PYTHON, str(SCRIPT), "--batch", manifest_path, str(TEMPLATE_DIR)],
                capture_output=True,
                text=True,
                cwd=entry["subdir"],
            )
            assert result.returncode == 0, f"stderr: {result.stderr}"
            lines = [l for l in result.stdout.strip().splitlines() if l.strip()]
            assert len(lines) == 1
            actual_path = lines[0]
            assert os.path.exists(actual_path), f"apkg not found at {actual_path}"
            assert len(os.path.basename(actual_path).encode("utf-8")) <= 200
