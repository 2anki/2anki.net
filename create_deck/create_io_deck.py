"""
Entry point for generating Image Occlusion .apkg files.

Reads deck_info.json from the workspace directory passed as argv[1], writes
an .apkg to that directory, and prints the final path to stdout.

deck_info.json shape:
{
  "deckName": "My Deck",
  "mode": "hide_all" | "hide_one",
  "images": [
    {
      "imageName": "image_0.jpg",
      "header": "Chapter 1",
      "rects": [
        { "x": 100, "y": 50, "w": 200, "h": 100, "imgW": 800, "imgH": 600, "label": "" }
      ]
    }
  ]
}
"""

import json
import os
import sys
import traceback

from genanki import Note
from genanki.util import guid_for

from helpers.get_model import get_model
from helpers.get_model_id import get_model_id
from helpers.io_shapes import shapes_to_occlusion_field
from helpers.write_apkg import _write_new_apkg
from backend.utils.email_error_alert import send_error_email


IO_MODEL_NAME = "Image Occlusion"
IO_MODEL_ID = get_model_id(IO_MODEL_NAME)


def build_io_notes(image_entry, occlude_inactive, media_files):
    image_path = image_entry["imageName"]
    image_basename = os.path.basename(image_path)
    header = image_entry.get("header", "")
    rects = image_entry.get("rects", [])

    if not rects:
        return []

    occlusion_field = shapes_to_occlusion_field(rects, occlude_inactive)
    image_html = f'<img src="{image_basename}">'

    model = get_model(("io", IO_MODEL_ID, IO_MODEL_NAME, None, None, None))

    fields = [occlusion_field, image_html, header, "", ""]

    note_guid = guid_for(image_basename, header, occlusion_field)
    note = Note(model, fields=fields, guid=note_guid)

    media_files.append(image_path)
    return [note]


if __name__ == "__main__":
    workspace_dir = None
    try:
        if len(sys.argv) < 2:
            raise IOError("missing workspace directory argument")

        workspace_dir = sys.argv[1]
        data_file = os.path.join(workspace_dir, "deck_info.json")

        with open(data_file, "r", encoding="utf-8") as f:
            info = json.load(f)

        deck_name = info.get("deckName", "Image Occlusion")
        mode = info.get("mode", "hide_all")
        images = info.get("images", [])
        occlude_inactive = mode == "hide_all"

        import hashlib
        deck_id = abs(int(hashlib.sha1(deck_name.encode("utf-8")).hexdigest(), 16) % (10 ** 10))

        media_files = []
        notes = []

        workspace_real = os.path.realpath(workspace_dir)
        for image_entry in images:
            image_path = os.path.join(workspace_dir, image_entry["imageName"])
            resolved = os.path.realpath(image_path)
            if not resolved.startswith(workspace_real + os.sep):
                raise ValueError(f"imageName escapes workspace: {image_entry['imageName']}")
            full_entry = dict(image_entry, imageName=image_path)
            image_notes = build_io_notes(full_entry, occlude_inactive, media_files)
            notes.extend(image_notes)

        # Same rule as create_deck.py: image order is document order, and
        # Anki shows `due` as "New #N" for new cards.
        for position, note in enumerate(notes, start=1):
            note.due = position

        if not notes:
            print("No cards generated; exiting cleanly")
            sys.exit(0)

        deck_payload = [
            {
                "notes": notes,
                "id": deck_id,
                "desc": "",
                "name": deck_name,
            }
        ]

        original_cwd = os.getcwd()
        os.chdir(workspace_dir)
        _write_new_apkg(deck_payload, media_files)
        os.chdir(original_cwd)

    except Exception as e:
        if os.getenv("NODE_ENV") != "production":
            raise e
        ERROR_DETAILS = f"""
Error: {str(e)}
Traceback:
{traceback.format_exc()}
workspace_dir: {workspace_dir if workspace_dir else 'N/A'}
"""
        send_error_email(f"[ERROR] [2anki.net] IO deck - {str(e)}", ERROR_DETAILS)
        raise
