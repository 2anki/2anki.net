"""
genanki Model that pins stable ids on fields, templates and the notetype.

Anki 2.1.67+ reconciles an incoming notetype with the one already in the
collection by matching each field and template by its `id` when present, and by
name only when an id is missing (rslib notetype/merge.rs is_match). Stock genanki
emits no ids, so a rename of a field or template in a shipped notetype forks the
notetype on a returning user's next import and drops every note into
"conflicting". Pinning an id that survives a rename freezes the match on id.

Id sources, by notetype kind:
- Shipped notetypes (src/templates/n2a-*.json): each field carries an explicit
  integer `id` in the JSON, seeded by `stable_entry_id(<notetype name>, <field
  name>)` and then frozen. A future field rename edits the JSON `name` and keeps
  the `id`, so the id survives the rename. genanki passes the JSON `id` straight
  through, so setdefault below leaves it untouched.
- Templates and dynamically built notetypes (get_custom_model, the apkg-input
  transform): no JSON to freeze, so the id is derived here from the notetype name
  and the entry name. A shipped notetype has a single template whose name is the
  notetype name, and a transform notetype mirrors the user's own uploaded deck, so
  the derived id is stable for the same input.

`originalId` is set to the notetype id. genanki's to_json passes field/template
ids through but never emits notetype-level extras, so originalId is added here.

`originalStockKind` is Anki's marker for notetypes derived from a built-in stock
kind. Anki only lets its mask editor edit an Image Occlusion note when the
notetype reports the Image Occlusion stock kind, so shipped notetypes that mirror
a stock kind carry `original_stock_kind` and it is emitted alongside originalId.

Notetype `mod` (see #4407): stock genanki stamps the notetype with the export
timestamp on every write, so re-uploading a deck always looks "newer" than the
copy already in the user's collection and Anki overwrites any CSS or template
edit the user made there. We pin notetype `mod` to a constant instead, bumped
only when a shipped template or CSS actually changes -- an unrelated re-export
minutes later then carries the *same* mod and no longer clobbers local edits.
The constant must stay >= every mod value already sitting in a returning
user's collection (all of them are past export timestamps, so any timestamp
at or after this line was written satisfies that). Note-level `mod` is
unaffected by this -- that's #4445, gated on a migration.
"""
import hashlib

from genanki import Model

_ID_SPACE = 10 ** 13

# Bump this whenever a shipped notetype's template or CSS changes. Anki only
# overwrites the local copy when the incoming mod is newer, so a re-export
# with the same constant leaves a returning user's own template/CSS edits
# alone; bumping it is what pushes a real 2anki-side template fix to them.
NOTETYPE_MOD = 1789650998


def stable_entry_id(notetype_name, entry_name):
    """
    Deterministic positive integer id for a field or template, scoped to its
    notetype. Same derivation shape as get_model_id (SHA1 of the name, taken
    modulo a fixed space) so the whole id family is consistent and reproducible.
    """
    key = f"{notetype_name}:{entry_name}".encode("utf-8")
    return int(hashlib.sha1(key).hexdigest(), 16) % _ID_SPACE or 1


class N2AModel(Model):
    """
    Model that guarantees a stable `id` on every field and template, sets
    `originalId` to the notetype id, and optionally reports an Anki stock kind.
    """

    def __init__(self, *args, original_stock_kind=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.original_stock_kind = original_stock_kind

    def to_json(self, timestamp, deck_id):
        data = super().to_json(timestamp, deck_id)
        for field in data["flds"]:
            field.setdefault("id", stable_entry_id(self.name, field["name"]))
        for template in data["tmpls"]:
            template.setdefault("id", stable_entry_id(self.name, template["name"]))
        data["originalId"] = self.model_id
        if self.original_stock_kind is not None:
            data["originalStockKind"] = self.original_stock_kind
        data["mod"] = NOTETYPE_MOD
        return data
