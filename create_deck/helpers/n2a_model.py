"""
The notetype a deck ships with, and the stable ids it pins.

Anki 2.1.67+ reconciles an incoming notetype with the one already in the
collection by matching each field and template by its `id` when present, and by
name only when an id is missing (rslib notetype/merge.rs is_match). A rename of
a field or template in a shipped notetype without an id forks the notetype on a
returning user's next import and drops every note into "conflicting". Pinning
an id that survives a rename freezes the match on id.

Id sources, by notetype kind:
- Shipped notetypes (src/templates/n2a-*.json): each field carries an explicit
  integer `id` in the JSON, seeded by `stable_entry_id(<notetype name>, <field
  name>)` and then frozen. A future field rename edits the JSON `name` and keeps
  the `id`, so the id survives the rename.
- Templates and dynamically built notetypes (get_custom_model): no JSON to
  freeze, so the id is derived here from the notetype name and the entry name.
  A shipped notetype has a single template whose name is the notetype name, so
  the derived id is stable for the same input.

`originalId` is set to the notetype id. `originalStockKind` is Anki's marker
for notetypes derived from a built-in stock kind: Anki only lets its mask
editor edit an Image Occlusion note when the notetype reports the Image
Occlusion stock kind.

Notetype `mod` (see #4407): a packager that stamps the notetype with the export
time makes every re-upload look "newer" than the copy already in the user's
collection, and Anki then overwrites any CSS or template edit the user made
there. `mod` is pinned to a constant instead, bumped only when a shipped
template or CSS actually changes, so an unrelated re-export carries the *same*
mod and leaves local edits alone. The constant must stay >= every mod value
already sitting in a returning user's collection (all of them are past export
timestamps, so any timestamp at or after this line was written satisfies that).
"""
import hashlib
from dataclasses import dataclass, field

_ID_SPACE = 10 ** 13

# Bump this whenever a shipped notetype's template or CSS changes. Anki only
# overwrites the local copy when the incoming mod is newer, so a re-export
# with the same constant leaves a returning user's own template/CSS edits
# alone; bumping it is what pushes a real 2anki-side template fix to them.
NOTETYPE_MOD = 1792838415

FRONT_BACK = 0
CLOZE = 1


def stable_entry_id(notetype_name, entry_name):
    """
    Deterministic positive integer id for a field or template, scoped to its
    notetype. Same derivation shape as get_model_id (SHA1 of the name, taken
    modulo a fixed space) so the whole id family is consistent and reproducible.
    """
    key = f"{notetype_name}:{entry_name}".encode("utf-8")
    return int(hashlib.sha1(key).hexdigest(), 16) % _ID_SPACE or 1


@dataclass
class N2AModel:
    """
    A notetype as 2anki describes it: fields and templates are plain dicts in
    the shape of src/templates/n2a-*.json. `to_notetype_dict` turns it into the
    dict Anki's collection API stores, with every id, `originalId`, the stock
    kind and the pinned `mod` in place.
    """

    FRONT_BACK = FRONT_BACK
    CLOZE = CLOZE

    model_id: int
    name: str
    fields: list = field(default_factory=list)
    templates: list = field(default_factory=list)
    css: str = ""
    model_type: int = FRONT_BACK
    original_stock_kind: int | None = None

    def to_notetype_dict(self, collection):
        notetype = collection.models.new(self.name)
        notetype["id"] = self.model_id
        notetype["type"] = self.model_type
        notetype["css"] = self.css or ""
        notetype["mod"] = NOTETYPE_MOD
        notetype["originalId"] = self.model_id
        notetype["originalStockKind"] = self.original_stock_kind or 0

        for entry in self.fields:
            new_field = collection.models.new_field(entry["name"])
            new_field["id"] = entry.get("id", stable_entry_id(self.name, entry["name"]))
            for key in ("tag", "preventDeletion"):
                if key in entry:
                    new_field[key] = entry[key]
            collection.models.add_field(notetype, new_field)

        for entry in self.templates:
            new_template = collection.models.new_template(entry["name"])
            new_template["qfmt"] = entry["qfmt"]
            new_template["afmt"] = entry["afmt"]
            new_template["id"] = entry.get("id", stable_entry_id(self.name, entry["name"]))
            collection.models.add_template(notetype, new_template)

        return notetype
