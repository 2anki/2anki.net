from pathlib import Path
import importlib.util as _ilu

_spec = _ilu.spec_from_file_location(
    "create_deck_script", Path(__file__).parents[1] / "create_deck.py"
)
_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
_media_field_value = _mod._media_field_value


def test_plain_path_entries_show_only_the_bundled_name():
    media = ["/tmp/workspaces/abc-123/0f3a.png", "/tmp/workspaces/abc-123/b2.mp3"]
    assert _media_field_value(media) == "0f3a.png,b2.mp3"


def test_mapping_entries_show_their_declared_name():
    media = [{"path": "/tmp/x/a.png", "name": "folder-a.png"}]
    assert _media_field_value(media) == "folder-a.png"


def test_a_bare_filename_is_unchanged():
    assert _media_field_value(["a.png"]) == "a.png"
