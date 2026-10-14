"""
guid_for, carried over unchanged from genanki (MIT, Kerrick Staley) so a note
keeps the guid it had before the packager moved to Anki's own engine. Anki
matches an imported note to the one already in the collection by guid, so a
drift here would turn every re-upload into a duplicate deck. The vectors are
pinned in tests/test_stable_guids.py and mirrored in src/lib/anki/guid.test.ts.
"""

import hashlib

BASE91_TABLE = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's',
    't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
    'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '0', '1', '2', '3', '4',
    '5', '6', '7', '8', '9', '!', '#', '$', '%', '&', '(', ')', '*', '+', ',', '-', '.', '/', ':',
    ';', '<', '=', '>', '?', '@', '[', ']', '^', '_', '`', '{', '|', '}', '~']


def guid_for(*values):
    hash_str = '__'.join(str(val) for val in values)

    digest = hashlib.sha256(hash_str.encode("utf-8")).digest()[:8]
    hash_int = int.from_bytes(digest, "big")

    rv_reversed = []
    while hash_int > 0:
        rv_reversed.append(BASE91_TABLE[hash_int % len(BASE91_TABLE)])
        hash_int //= len(BASE91_TABLE)

    return ''.join(reversed(rv_reversed))
