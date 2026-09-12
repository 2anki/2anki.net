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
"""
import hashlib

from genanki import Model

_ID_SPACE = 10 ** 13


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
    Model that guarantees a stable `id` on every field and template and sets
    `originalId` to the notetype id.
    """

    def to_json(self, timestamp, deck_id):
        data = super().to_json(timestamp, deck_id)
        for field in data["flds"]:
            field.setdefault("id", stable_entry_id(self.name, field["name"]))
        for template in data["tmpls"]:
            template.setdefault("id", stable_entry_id(self.name, template["name"]))
        data["originalId"] = self.model_id
        return data
