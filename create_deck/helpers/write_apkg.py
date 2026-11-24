"""
Writes an Anki package (.apkg) with Anki's own engine.

The deck payloads are built into a throwaway collection through the official
collection API, then exported with the same code path Anki desktop uses for
File > Export. Anki owns the schema, the card generation, the media gathering
and the package layout, so the package is whatever current Anki writes.

What this module pins on top of Anki's defaults, and why:
- Notetypes and decks keep the ids 2anki assigns, so a returning user's import
  updates in place instead of forking. Anki honours a caller-supplied id only
  through the "add or update with existing id" path, which is what
  `models.update(preserve_usn=True)` and `decks.update(preserve_usn=True)` call.
- The notetype `mod` is the one N2AModel sets (the shared constant, or a later
  style change time); `preserve_usn=True` is also what keeps it instead of
  stamping the build time.
- Notes are numbered from 1 in document order. Anki shows a new card's `due`
  as "New #N", and it is the only carrier of document order the user can see
  or sort by. One counter across every deck in the file, so parent -> child
  page order survives too.
- A note whose `mod` is pinned gets it written after the add, because the add
  itself always stamps the current time.
- Media is copied into the collection's media folder under its own basename
  when Anki accepts that name. A name Anki would refuse (helpers/media_names)
  is stored under the name Anki gives it, and the note fields are pointed at
  that name before the notes are added. Anki then packages every file a note
  or template actually references.
"""

import os
import re
import shutil
import sys
import tempfile
import unicodedata
import uuid

from anki.collection import AddNoteRequest, Collection, ExportAnkiPackageOptions
from anki.errors import InvalidInput
from anki.notes import Note

from helpers.media_names import (
    anki_stored_names,
    is_accepted,
    is_plain_name,
    rewrite_name_list,
    rewrite_references,
    store_renamed,
)

FIRST_CARD_POSITION = 1
MEDIA_LIST_FIELD = "MyMedia"
MEDIA_NOTICE_PREFIX = "[media-names]"
NEXT_CARD_POSITION_KEY = "nextPos"

EXPORT_OPTIONS = ExportAnkiPackageOptions(
    with_scheduling=True,
    with_deck_configs=False,
    with_media=True,
    legacy=True,
)


def sanitize_filename(filename):
    """
    Sanitize the filename by removing any character that is not alphanumeric, a space, or a hyphen.
    Replace spaces with hyphens. Ensures the result is safe for use as a filename.
    Other space characters (a non-breaking or ideographic space pasted from
    Notion) count as a space. Whitespace that is not a space (tabs, form feeds,
    U+2028, record separators) is dropped: str.splitlines() treats those as
    line breaks, and a path printed with one in it reaches the caller as a
    bare fragment.
    """
    spaced = ''.join(
        ' ' if unicodedata.category(char) == 'Zs' else char for char in filename
    )
    sanitized = re.sub(r'[^\S ]', '', spaced)
    sanitized = re.sub(
        r'[^\w\s\-\U0001F600-\U0001F64F]', '', sanitized, flags=re.UNICODE
    )
    sanitized = sanitized.replace(' ', '-')
    return os.path.basename(sanitized)


def _register_notetype(collection, registered, model):
    notetype = registered.get(model.model_id)
    if notetype is None:
        notetype = model.to_notetype_dict(collection)
        collection.models.update(notetype, preserve_usn=True, skip_checks=True)
        registered[model.model_id] = notetype
    return notetype


def _add_deck(collection, deck_payload):
    deck = collection.decks.new_deck_legacy(False)
    deck["id"] = int(deck_payload["id"])
    deck["name"] = deck_payload["name"]
    deck["desc"] = deck_payload.get("desc", "")
    collection.decks.update(deck, preserve_usn=True)
    return deck["id"]


def _renamed_fields(n2a_note, renames):
    if not renames:
        return list(n2a_note.fields)
    field_names = [entry["name"] for entry in n2a_note.model.fields]
    renamed = []
    for index, value in enumerate(n2a_note.fields):
        is_name_list = index < len(field_names) and field_names[index] == MEDIA_LIST_FIELD
        if is_name_list:
            renamed.append(rewrite_name_list(value, renames))
        else:
            renamed.append(rewrite_references(value, renames))
    return renamed


def _add_notes(collection, deck_id, n2a_notes, registered, renames):
    requests = []
    for n2a_note in n2a_notes:
        notetype = _register_notetype(collection, registered, n2a_note.model)
        note = Note(collection, model=notetype)
        note.fields = _renamed_fields(n2a_note, renames)
        note.tags = list(n2a_note.tags)
        if n2a_note.guid:
            note.guid = n2a_note.guid
        requests.append(AddNoteRequest(note=note, deck_id=deck_id))
    if requests:
        collection.add_notes(requests)
    return [
        (int(n2a_note.mod), request.note.id)
        for n2a_note, request in zip(n2a_notes, requests)
        if n2a_note.mod is not None
    ]


def _normalize_media_entry(entry):
    """
    A media entry is either a plain path (the parser path, bundled under its
    own basename) or a {"path", "name"} mapping (the AI path, where "name" is a
    collision-free filename that two same-named files from different folders can
    each keep). Return the (source path to read, basename to bundle under) pair.
    """
    if isinstance(entry, dict):
        return entry["path"], os.path.basename(entry["name"])
    return entry, os.path.basename(entry)


def _sources_by_name(media_files):
    cwd_real = os.path.realpath(os.getcwd())
    sources = {}
    for source_path, bundled_name in media_files:
        source_real = os.path.realpath(source_path)
        if source_real != cwd_real and not source_real.startswith(cwd_real + os.sep):
            print(
                f"Skipping media outside the working directory: {source_path}",
                file=sys.stderr,
            )
            continue
        sources[bundled_name] = source_real
    return sources


def _copy_media(collection, media_files):
    """
    Copy every media file into the collection and return {bundled name: new
    name} for the files Anki would refuse under their own name. Names Anki
    accepts are copied first and unchanged, so a renamed file can never take
    the name of a file that already had it.
    """
    media_dir = collection.media.dir()
    sources = _sources_by_name(media_files)
    stored_names = anki_stored_names(
        [name for name in sources if not is_plain_name(name)]
    )
    refused = [
        name for name in stored_names if not is_accepted(name, stored_names[name])
    ]
    refused_names = set(refused)
    for name, source in sources.items():
        if name not in refused_names:
            shutil.copyfile(source, os.path.join(media_dir, name))
    renames = {}
    for name in refused:
        with open(sources[name], "rb") as handle:
            data = handle.read()
        renames[name] = store_renamed(collection, name, stored_names[name], data)
    if renames:
        print(
            f"{MEDIA_NOTICE_PREFIX} renamed {len(renames)} media file(s) to names Anki accepts",
            file=sys.stderr,
        )
    return renames


def fill_collection(collection, deck_payloads, media_files):
    """
    Add every deck, notetype, note and media file to the collection. Returns
    the (mod, note id) pairs that pin a note's mod.
    """
    collection.models.remove_all_notetypes()
    collection.set_config(NEXT_CARD_POSITION_KEY, FIRST_CARD_POSITION)
    renames = _copy_media(collection, media_files)

    registered = {}
    pinned_mods = []
    for deck_payload in deck_payloads:
        deck_id = _add_deck(collection, deck_payload)
        pinned_mods.extend(
            _add_notes(collection, deck_id, deck_payload["notes"], registered, renames)
        )

    _pin_mods(collection, pinned_mods)
    return pinned_mods


def _pin_mods(collection, pinned_mods):
    if pinned_mods:
        collection.db.executemany(
            "update notes set mod = ? where id = ?", pinned_mods
        )


def _export(collection, out_path):
    collection.export_anki_package(
        out_path=out_path, options=EXPORT_OPTIONS, limit=None
    )


def export_package(collection, out_path, pinned_mods):
    """
    Export the collection. If Anki still refuses a media name, run its own
    media check (which renames the files and the references to them), restore
    the pinned note mods the check overwrote, and export once more.
    """
    try:
        _export(collection, out_path)
    except InvalidInput:
        media_dir = collection.media.dir()
        before = set(os.listdir(media_dir))
        collection.media.check()
        renamed = len(before - set(os.listdir(media_dir)))
        _pin_mods(collection, pinned_mods)
        print(
            f"{MEDIA_NOTICE_PREFIX} export refused a media name; Anki's media check "
            f"renamed {renamed} media file(s) and the export was retried",
            file=sys.stderr,
        )
        _export(collection, out_path)


def write_package_to_temp_file(deck_payloads, media_files):
    """
    Build the decks into a throwaway collection and export it as an .apkg in
    the temp directory. Returns the path to the package.
    """
    temp_path = os.path.join(
        tempfile.gettempdir(), f"temp_apkg_{uuid.uuid4().hex}.apkg"
    )
    collection_dir = tempfile.mkdtemp(prefix="2anki-collection-")
    try:
        collection = Collection(os.path.join(collection_dir, "collection.anki2"))
        try:
            pinned_mods = fill_collection(collection, deck_payloads, media_files)
            export_package(collection, temp_path, pinned_mods)
        finally:
            collection.close()
    except Exception as e:
        print(f"Error writing to temporary file: {e}", file=sys.stderr)
        raise
    finally:
        shutil.rmtree(collection_dir, ignore_errors=True)

    return temp_path


def _validate_path_safety(name_str, id_str):
    """Validate inputs for path traversal attempts."""
    dangerous_patterns = ['..', '/', '\\', ':']
    for pattern in dangerous_patterns:
        if pattern in name_str or pattern in id_str:
            raise ValueError("Path traversal attempt detected in filename")


def _create_safe_filename(sanitized_name, first_deck_id):
    """Create a safe filename from sanitized inputs."""
    safe_name = os.path.basename(str(sanitized_name))
    safe_deck_id = os.path.basename(str(first_deck_id))
    base_filename = f'{safe_name}-{safe_deck_id}'

    if len(base_filename) + len(".apkg") > 255:
        base_filename = base_filename[:245] + "-trunc"

    return os.path.basename(f"{base_filename}.apkg")


def _verify_path_within_cwd(final_path, cwd):
    """Verify the final path is within the current working directory."""
    real_final_path = os.path.realpath(final_path)
    real_cwd = os.path.realpath(cwd)

    if not real_final_path.startswith(real_cwd + os.sep) and not real_final_path == real_cwd:
        raise ValueError("Path traversal attempt detected in final path")


def rename_temp_file(temp_path, sanitized_name, first_deck_id):
    """
    Rename the temporary file to a final filename.

    Args:
        temp_path (str): The path to the temporary file.
        sanitized_name (str): The sanitized name for the final file.
        first_deck_id (str): The ID of the first deck.

    Returns:
        str: The path to the final file.
    """
    name_str = str(sanitized_name)
    id_str = str(first_deck_id)

    _validate_path_safety(name_str, id_str)

    final_filename = _create_safe_filename(sanitized_name, first_deck_id)
    cwd = os.getcwd()
    final_path = os.path.join(cwd, final_filename)

    _verify_path_within_cwd(final_path, cwd)

    try:
        os.replace(temp_path, final_path)
    except OSError as e:
        if e.errno == 36:
            fallback_filename = f"deck_{uuid.uuid4().hex[:8]}.apkg"
            final_path = os.path.join(cwd, fallback_filename)
            _verify_path_within_cwd(final_path, cwd)
            os.replace(temp_path, final_path)
        else:
            raise ValueError("Failed to rename file") from e

    return final_path


def _write_new_apkg(deck_payloads, media_files):
    """
    Write a new Anki package file (.apkg) using provided deck payloads and media files.

    Args:
        deck_payloads (list): List of dictionaries containing deck information.
        media_files (list): List of media files to be included in the package.
    """
    normalized = [_normalize_media_entry(entry) for entry in media_files]
    missing = {source for source, _ in normalized if not os.path.exists(source)}
    if missing:
        print(f"Skipping {len(missing)} missing media file(s): {missing}", file=sys.stderr)
    existing_media = list(
        dict.fromkeys(pair for pair in normalized if os.path.exists(pair[0]))
    )

    sanitized_name = sanitize_filename(deck_payloads[0]["name"]) if deck_payloads else "default"
    first_deck_id = str(deck_payloads[0]["id"]) if deck_payloads else ""
    temp_path = write_package_to_temp_file(deck_payloads, existing_media)
    final_path = rename_temp_file(temp_path, sanitized_name, first_deck_id)

    try:
        sys.stdout.write(final_path)
    except UnicodeEncodeError:
        sys.stdout.buffer.write(final_path.encode('utf-8'))
