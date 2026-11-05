import json
import os
import subprocess
import sys

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "create_io_deck.py")
IMAGE_NAME = "../Cardiac Anatomy Midterm.png"


def test_escape_error_leaves_out_the_image_name(tmp_path):
    (tmp_path / "deck_info.json").write_text(
        json.dumps({"deckName": "Deck", "images": [{"imageName": IMAGE_NAME}]}),
        encoding="utf-8",
    )
    env = {k: v for k, v in os.environ.items() if k != "NODE_ENV"}

    result = subprocess.run(
        [sys.executable, SCRIPT, str(tmp_path)],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )

    assert result.returncode != 0
    assert "imageName escapes workspace" in result.stderr
    assert "Cardiac Anatomy" not in result.stderr + result.stdout
