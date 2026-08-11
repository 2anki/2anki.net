"""
Builds one or more Anki .apkg files from deck_info.json payloads.

Single-deck mode (legacy):  python create_deck.py <deck_info.json> <template_dir>
Batch mode:                 python create_deck.py --batch <manifest.json>

Manifest shape: [{"input": "/abs/path/deck_info.json", "output": "/abs/path/out.apkg"}, ...]
"""

import traceback
import json
import sys
import os

from genanki import Note
from genanki.util import guid_for

from helpers.cards import get_safe_value
from helpers.get_model import get_custom_model, get_model, resolve_tts_langs
from helpers.get_model_id import get_model_id
from helpers.get_template import get_template
from helpers.read_template import read_template
from helpers.sanitize_tags import sanitize_tags
from helpers.write_apkg import _write_new_apkg
from backend.utils.email_error_alert import send_error_email

_MAX_BASENAME_BYTES = 200


def _clamp_output_path(path: str) -> str:
    directory = os.path.dirname(path)
    basename = os.path.basename(path)
    encoded = basename.encode("utf-8")
    if len(encoded) <= _MAX_BASENAME_BYTES:
        return path
    ext = b".apkg"
    max_stem_bytes = _MAX_BASENAME_BYTES - len(ext)
    stem_bytes = encoded[: -len(ext)] if basename.endswith(".apkg") else encoded
    truncated = stem_bytes[:max_stem_bytes]
    while truncated:
        try:
            stem_str = truncated.decode("utf-8")
            break
        except UnicodeDecodeError:
            truncated = truncated[:-1]
    else:
        stem_str = ""
    new_basename = stem_str + ".apkg"
    return os.path.join(directory, new_basename)


def build_one_deck(data_file, template_dir):
    # pylint: disable=invalid-name,too-many-locals,too-many-branches,too-many-statements,import-outside-toplevel
    """
    Builds a single .apkg from data_file, returns the output path printed by _write_new_apkg.
    All state is local — safe to call repeatedly in a single process.

    UPPER_CASE locals (STYLING, CLOZE_STYLE, FMT_*) are conceptual template constants
    that pylint can't recognize as constants inside a function body. The local-imports
    of io/redirect_stdout are intentional — only used in legacy single-deck CLI mode.
    """
    import io
    from contextlib import redirect_stdout

    CLOZE_STYLE = read_template(template_dir, "cloze_style.css", "", "")

    with open(data_file, "r", encoding="utf-8") as json_file:
        data = json.load(json_file)

    media_files = []
    decks = []
    guid_records = []

    if len(data) == 0:
        return None

    mt = data[0].get("settings", {})
    STYLING = data[0].get('style', "") or ""

    cloze_model_name = mt.get('clozeModelName', "n2a-cloze") or "n2a-cloze"
    basic_model_name = mt.get('basicModelName', "n2a-basic") or "n2a-basic"
    input_model_name = mt.get('inputModelName', "n2a-input") or "n2a-input"

    input_model_id = mt.get('inputModelId', get_model_id(input_model_name))
    cloze_model_id = mt.get('clozeModelId', get_model_id(cloze_model_name))
    basic_model_id = mt.get('basicModelId', get_model_id(basic_model_name))
    template = mt.get('template', 'specialstyle')

    FMT_CLOZE_QUESTION = FMT_CLOZE_ANSWER = None
    FMT_INPUT_QUESTION = FMT_INPUT_ANSWER = None
    FMT_QUESTION = FMT_ANSWER = None

    if template == 'specialstyle':
        STYLING += read_template(template_dir, "custom.css", "", "")
    elif template == 'nostyle':
        STYLING = ""
    elif template == 'abhiyan':
        STYLING = read_template(template_dir, 'abhiyan.css', "", "")
        CLOZE_STYLE = read_template(template_dir, "abhiyan_cloze_style.css", "", "")
        FMT_CLOZE_QUESTION = read_template(template_dir, "abhiyan_cloze_front.html", "", "")
        FMT_CLOZE_ANSWER = read_template(template_dir, "abhiyan_cloze_back.html", "", "")
        FMT_QUESTION = read_template(template_dir, "abhiyan_basic_front.html", "", "")
        FMT_ANSWER = read_template(template_dir, "abhiyan_basic_back.html", "", "")
        FMT_INPUT_QUESTION = read_template(template_dir, "abhiyan_input_front.html", "", "")
        FMT_INPUT_ANSWER = read_template(template_dir, "abhiyan_basic_back.html", "", "")
    elif template == 'alex_deluxe':
        STYLING = read_template(template_dir, 'alex_deluxe.css', "", "")
        CLOZE_STYLE = read_template(template_dir, "alex_deluxe_cloze_style.css", "", "")
        FMT_CLOZE_QUESTION = read_template(template_dir, "alex_deluxe_cloze_front.html", "", "")
        FMT_CLOZE_ANSWER = read_template(template_dir, "alex_deluxe_cloze_back.html", "", "")
        FMT_QUESTION = read_template(template_dir, "alex_deluxe_basic_front.html", "", "")
        FMT_ANSWER = read_template(template_dir, "alex_deluxe_basic_back.html", "", "")
        FMT_INPUT_QUESTION = read_template(template_dir, "alex_deluxe_input_front.html", "", "")
        FMT_INPUT_ANSWER = read_template(template_dir, "alex_deluxe_input_back.html", "", "")

    USE_CUSTOM_TEMPLATE = template == 'custom'
    CLOZE_STYLE = CLOZE_STYLE + "\n" + STYLING
    BASIC_STYLE = STYLING
    BASIC_FRONT = FMT_QUESTION
    BASIC_BACK = FMT_ANSWER

    n2aBasic = mt.get("n2aBasic")
    if n2aBasic and USE_CUSTOM_TEMPLATE:
        BASIC_STYLE = n2aBasic["styling"]
        BASIC_FRONT = n2aBasic["front"]
        BASIC_BACK = n2aBasic["back"]

    CLOZE_FRONT = FMT_CLOZE_QUESTION
    CLOZE_BACK = FMT_CLOZE_ANSWER
    n2aCloze = mt.get("n2aCloze")
    if n2aCloze and USE_CUSTOM_TEMPLATE:
        CLOZE_STYLE = n2aCloze["styling"]
        CLOZE_FRONT = n2aCloze["front"]
        CLOZE_BACK = n2aCloze["back"]

    n2aInput = mt.get("n2aInput")
    INPUT_FRONT = FMT_INPUT_QUESTION
    INPUT_BACK = FMT_INPUT_ANSWER
    INPUT_STYLE = STYLING
    if n2aInput and USE_CUSTOM_TEMPLATE:
        INPUT_STYLE = n2aInput["styling"]
        INPUT_FRONT = n2aInput["front"]
        INPUT_BACK = n2aInput["back"]

    HIERARCHY_MODEL_NAME = "n2a-hierarchy"
    hierarchy_model_id = get_model_id(HIERARCHY_MODEL_NAME)
    HIERARCHY_STYLE = (BASIC_STYLE or "") + "\n" + (
        get_template("n2a-hierarchy.json").get("styling") or ""
    )

    mcq_model_name = mt.get('mcqModelName', "n2a-mcq") or "n2a-mcq"
    mcq_model_id = mt.get('mcqModelId', get_model_id(mcq_model_name))
    mcq_settings = {
        "mcqTtsQuestion": mt.get("mcqTtsQuestion", ""),
        "mcqTtsCorrectAnswer": mt.get("mcqTtsCorrectAnswer", ""),
        "mcqTtsExtra": mt.get("mcqTtsExtra", ""),
    }
    front_lang, back_lang = resolve_tts_langs(mt)

    for deck in data:
        cards = deck.get("cards", [])
        notes = []
        for card in cards:
            tags = sanitize_tags(card.get('tags', []))
            front = card.get("name", "")
            back = card.get("back", "")
            fields = [front, back, ",".join(card["media"])]
            model = get_model(("basic", basic_model_id, basic_model_name,
                               BASIC_STYLE, BASIC_FRONT, BASIC_BACK),
                              front_lang=front_lang, back_lang=back_lang)
            custom_fields = card.get("customFields")
            custom_field_names = card.get("customFieldNames")
            custom_model_name = card.get("customModelName")
            use_custom_model = bool(custom_fields and custom_field_names and custom_model_name)
            if use_custom_model:
                is_cloze_custom = bool(card.get('cloze', False))
                model = get_custom_model(
                    custom_model_name,
                    custom_field_names,
                    is_cloze=is_cloze_custom,
                    css=CLOZE_STYLE if is_cloze_custom else BASIC_STYLE,
                )
                fields = [get_safe_value(value) for value in custom_fields]
            elif card.get('mcq', False):
                options = card.get('options', [])
                correct_indices = card.get('correctIndices', [])
                options_html = "<br>".join(options)
                correct_answer = options[correct_indices[0]] if correct_indices and correct_indices[0] < len(options) else ""
                extra = back
                model = get_model(("mcq", mcq_model_id, mcq_model_name, "", None, None), mcq_settings=mcq_settings)
                fields = [front, options_html, correct_answer, extra]
            elif card.get('cloze', False) and "{{c" in front:
                model = get_model(
                    ("cloze", cloze_model_id, cloze_model_name,
                     CLOZE_STYLE, CLOZE_FRONT, CLOZE_BACK),
                    front_lang=front_lang, back_lang=back_lang)
            elif card.get('enableInput', False) and card.get('answer', False):
                model = get_model(
                    ("input", input_model_id, input_model_name,
                     INPUT_STYLE, INPUT_FRONT, INPUT_BACK),
                    front_lang=front_lang, back_lang=back_lang)
                fields = [
                    front.replace("{{type:Input}}", ""),
                    back,
                    card["answer"],
                    ",".join(card["media"]),
                ]
            elif card.get('hierarchy', False):
                model = get_model(
                    ("hierarchy", hierarchy_model_id, HIERARCHY_MODEL_NAME,
                     HIERARCHY_STYLE, None, None),
                    front_lang=front_lang, back_lang=back_lang)
                fields = [
                    get_safe_value(card.get("h1", "")),
                    get_safe_value(card.get("h2", "")),
                    get_safe_value(card.get("h3", "")),
                    get_safe_value(front),
                    get_safe_value(back),
                    ",".join(card["media"]),
                ]

            if len(fields) > 0:
                fields[0] = get_safe_value(fields[0])
            if len(fields) > 1:
                fields[1] = get_safe_value(fields[1])

            if card["number"] == -1 and "notionId" in card:
                card["number"] = card["notionId"]

            explicit_guid = card.get("guid")
            notion_id = card.get("notionId")
            if explicit_guid:
                guid = explicit_guid
            elif notion_id and not deck.get("useContentGuid"):
                guid = guid_for(notion_id)
            else:
                card_type = "cloze" if card.get("cloze") else ("mcq" if card.get("mcq") else ("input" if card.get("enableInput") else "basic"))
                guid_value = front if card.get('hierarchy', False) else fields[0]
                guid = guid_for(deck["name"], guid_value, card_type)
            my_note = Note(model, fields=fields,
                           sort_field=card["number"], tags=tags,
                           guid=guid)
            guid_records.append({"notionId": notion_id, "guid": guid})
            notes.append(my_note)
            media_files = media_files + card["media"]

        decks.append(
            {
                "notes": notes,
                "id": deck["id"],
                "desc": "",
                "name": deck["name"],
            }
        )

    try:
        sidecar_path = os.path.join(os.path.dirname(data_file), "guids.json")
        with open(sidecar_path, "w", encoding="utf-8") as guid_file:
            json.dump(guid_records, guid_file)
    except OSError:
        pass  # best-effort: the ledger skips recording, never fail the build

    buf = io.StringIO()
    with redirect_stdout(buf):
        _write_new_apkg(decks, media_files)
    return buf.getvalue().strip()


def run_batch(manifest_path, template_dir):
    with open(manifest_path, "r", encoding="utf-8") as f:
        entries = json.load(f)

    # One failing entry must not abort the batch: the caller retries entries
    # that produced no output line individually, so report the failure on
    # stderr and keep building the rest (#4028 shipped zero decks because a
    # single bad page killed every deck in its chunk).
    for entry in entries:
        input_path = entry["input"]
        output_path = _clamp_output_path(entry["output"])
        deck_dir = os.path.dirname(input_path)

        original_cwd = os.getcwd()
        try:
            os.chdir(deck_dir)
            apkg_path = build_one_deck(input_path, template_dir)

            if apkg_path and apkg_path != output_path:
                os.replace(apkg_path, output_path)
                apkg_path = output_path

            if apkg_path:
                try:
                    sys.stdout.write(apkg_path + "\n")
                except UnicodeEncodeError:
                    sys.stdout.buffer.write((apkg_path + "\n").encode("utf-8"))
        except Exception as exc:  # pylint: disable=broad-exception-caught
            print(
                f"Failed to build deck from {input_path}: {exc}",
                file=sys.stderr,
            )
        finally:
            os.chdir(original_cwd)


if __name__ == "__main__":
    try:
        if len(sys.argv) < 2:
            raise IOError(
                'missing payload arguments(data file, deck style, template dir)')

        if sys.argv[1] == "--batch":
            if len(sys.argv) < 4:
                raise IOError("--batch requires: manifest_path template_dir")
            run_batch(sys.argv[2], sys.argv[3])
            sys.exit(0)

        if len(sys.argv) < 3:
            print("usage: create_deck.py <deck_info.json> <template_dir>", file=sys.stderr)
            sys.exit(1)

        DATA_FILE = sys.argv[1]
        TEMPLATE_DIR = sys.argv[2]

        original_cwd = os.getcwd()
        apkg_path = build_one_deck(DATA_FILE, TEMPLATE_DIR)
        if apkg_path is None:
            print('No cards generated; exiting cleanly')
            sys.exit(0)
        try:
            sys.stdout.write(apkg_path)
        except UnicodeEncodeError:
            sys.stdout.buffer.write(apkg_path.encode('utf-8'))

    except Exception as e:
        if os.getenv('NODE_ENV') != 'production':
            raise e
        error_details = f"""
Error: {str(e)}
Traceback:
{traceback.format_exc()}
Environment:
DATA_FILE: {DATA_FILE if 'DATA_FILE' in locals() else 'N/A'}
"""
        send_error_email(f"[ERROR] [2anki.net] - {str(e)}", error_details)
        raise
