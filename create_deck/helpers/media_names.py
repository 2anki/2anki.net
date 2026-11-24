"""
Media file names Anki accepts, decided by Anki itself.

Anki's exporter refuses the whole package ("Please use the Check Media
action") when a note references a media file whose name is not the one Anki
would have stored it under. The rule lives in Anki's Rust backend
(normalize_filename): characters []<>:"/?*^\\| and control characters are
removed, the name is NFC-normalised, cut to 120 bytes keeping the extension,
a Windows device name (con, nul, com1...) gets a trailing underscore, and so
does a name ending in a dot or a space. The Python package does not expose
that function, but add_media_file applies it, so the stored name is read back
from a throwaway probe collection instead of being reimplemented here.
add_media_file also lowercases the name it stores, while the exporter accepts
any case, so a name is accepted when it matches Anki's name ignoring case.
"""

import hashlib
import html
import os
import re
import shutil
import tempfile

from anki.collection import Collection
from anki.errors import BackendError

MAX_PLAIN_NAME_BYTES = 120
PLAIN_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*")
WINDOWS_DEVICE_STEMS = frozenset(
    ["con", "prn", "aux", "nul"]
    + [f"com{digit}" for digit in range(10)]
    + [f"lpt{digit}" for digit in range(10)]
)
FALLBACK_EXTENSION = re.compile(r"\.[A-Za-z0-9]{1,10}")
QUOTED_REFERENCE = re.compile(r"""(?i)(\b(?:src|data)\s*=\s*)(?:"([^"]*)"|'([^']*)')""")
UNQUOTED_REFERENCE = re.compile(r"""(?i)(\b(?:src|data)\s*=\s*)([^\s"'<>=`]+?)(?=/>|[\s>]|$)""")
SOUND_REFERENCE = re.compile(r"\[sound:([^\]]*)\]")


def is_plain_name(name):
    """
    True for a name every Anki version stores unchanged: ASCII letters,
    digits, '_' and '-' between dots, at most 120 bytes, not a Windows device
    name. 2anki's own content-hash names all qualify, so they skip the probe.
    """
    if len(name) > MAX_PLAIN_NAME_BYTES or not PLAIN_NAME.fullmatch(name):
        return False
    return name.split(".", 1)[0].lower() not in WINDOWS_DEVICE_STEMS


def anki_stored_names(names):
    """
    Map each name to the name Anki stores it under, or None when Anki keeps
    nothing of it (a name made only of refused characters). Every probe file
    has the same empty content, so Anki never adds a collision suffix and the
    result is the normalised name alone.
    """
    if not names:
        return {}
    probe_dir = tempfile.mkdtemp(prefix="2anki-media-names-")
    try:
        probe = Collection(os.path.join(probe_dir, "probe.anki2"))
        try:
            return {name: _probe(probe, name) for name in names}
        finally:
            probe.close()
    finally:
        shutil.rmtree(probe_dir, ignore_errors=True)


def is_accepted(name, stored_name):
    """True when the exporter takes the name as it is."""
    return stored_name is not None and stored_name.lower() == name.lower()


def _probe(probe, name):
    try:
        return probe.media.write_data(name, b"")
    except BackendError:
        return None


def store_renamed(collection, name, stored_name, data):
    """
    Write a file whose name Anki refuses and return the name it landed under.
    Anki gives a name that is already taken by different content a suffix of
    that content's SHA-1, so the result is the same on every build.
    """
    desired = name if stored_name else _content_name(name, data)
    return collection.media.write_data(desired, data)


def _content_name(name, data):
    extension = os.path.splitext(name)[1]
    if not FALLBACK_EXTENSION.fullmatch(extension):
        extension = ""
    return hashlib.sha1(data).hexdigest() + extension


def _reference_forms(renames):
    forms = {}
    for original, stored in renames.items():
        for form in (
            original,
            html.escape(original, quote=True),
            original.replace("&", "&amp;").replace('"', "&quot;").replace(" ", "&nbsp;"),
        ):
            forms.setdefault(form, stored)
    return forms


def _attribute_value(stored, quote):
    escaped = stored.replace("&", "&amp;")
    if quote == "'":
        return escaped.replace("'", "&#x27;")
    return escaped


def rewrite_references(text, renames):
    """
    Point every media reference in a note field (src= and data= attributes,
    quoted or not, and [sound:] tags) at the renamed file. Text that only
    mentions a name is left alone.
    """
    if not renames or not text:
        return text
    forms = _reference_forms(renames)

    def quoted(match):
        quote, value = ('"', match.group(2)) if match.group(2) is not None else ("'", match.group(3))
        stored = forms.get(value)
        if stored is None:
            return match.group(0)
        return f"{match.group(1)}{quote}{_attribute_value(stored, quote)}{quote}"

    def unquoted(match):
        stored = forms.get(match.group(2))
        if stored is None:
            return match.group(0)
        return f'{match.group(1)}"{_attribute_value(stored, chr(34))}"'

    def sound(match):
        stored = renames.get(match.group(1))
        return match.group(0) if stored is None else f"[sound:{stored}]"

    text = QUOTED_REFERENCE.sub(quoted, text)
    text = UNQUOTED_REFERENCE.sub(unquoted, text)
    text = SOUND_REFERENCE.sub(sound, text)
    for original in sorted(renames, key=len, reverse=True):
        if "]" in original:
            text = text.replace(f"[sound:{original}]", f"[sound:{renames[original]}]")
    return text


def rewrite_name_list(value, renames):
    """Rename the entries of a comma-joined list of media names (MyMedia)."""
    if not renames or not value:
        return value
    return ",".join(renames.get(name, name) for name in value.split(","))
