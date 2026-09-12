"""
Retrieve the correct genanki model
"""
from genanki import Model

from .get_model_id import get_model_id
from .get_template import get_template
from .n2a_model import N2AModel

MODEL_INFO = {
    "cloze": {
        "file_name": "n2a-cloze.json",
        "model_type": Model.CLOZE
    },
    "basic": {
        "file_name": "n2a-basic.json",
        "model_type": Model.FRONT_BACK
    },
    "input": {
        "file_name": "n2a-input.json",
        "model_type": Model.FRONT_BACK
    },
    "io": {
        "file_name": "n2a-io.json",
        "model_type": Model.CLOZE
    },
    "mcq": {
        "file_name": "n2a-mcq.json",
        "model_type": Model.FRONT_BACK
    },
    "hierarchy": {
        "file_name": "n2a-hierarchy.json",
        "model_type": Model.FRONT_BACK
    }
}

_TTS_FIELD_MAP = {
    "mcq-tts-question": "Question",
    "mcq-tts-correct-answer": "Correct Answer",
    "mcq-tts-extra": "Extra",
}


def _apply_mcq_settings(qfmt, afmt, mcq_settings):
    """
    Inject user-chosen MCQ TTS settings into the front and back templates.

    TTS tags — Anki's {{tts lang:Field}} is parsed at template-compile time, not at
    card render, so we cannot use field substitution; we must embed the lang code
    directly into the template string at build time.

    Shuffle and show-choices are now controlled by the in-card drawer at review time.
    The AUTO_SHOW_CHOICES (declared with var, not const, so the script can re-execute
    across cards without a SyntaxError redeclaration) and shuffleArray anchor strings
    remain in the template verbatim.
    """
    tts_lines_front = []
    tts_lines_back = []
    tts_key_to_setting = {
        "mcq-tts-question": "mcqTtsQuestion",
        "mcq-tts-correct-answer": "mcqTtsCorrectAnswer",
        "mcq-tts-extra": "mcqTtsExtra",
    }
    for tts_key, setting_key in tts_key_to_setting.items():
        lang = mcq_settings.get(setting_key, "") or ""
        if lang:
            field = _TTS_FIELD_MAP[tts_key]
            tts_tag = f"{{{{tts {lang}:{field}}}}}"
            if field == "Question":
                tts_lines_front.append(tts_tag)
            tts_lines_back.append(tts_tag)

    if tts_lines_front:
        qfmt = "\n".join(tts_lines_front) + "\n" + qfmt
    if tts_lines_back:
        afmt = "\n".join(tts_lines_back) + "\n" + afmt

    return qfmt, afmt


_FRONT_FIELD_BY_MODEL = {
    "basic": "Front",
    "input": "Front",
    "cloze": "Text",
    "hierarchy": "Question",
}

_BACK_FIELD_BY_MODEL = {
    "basic": "Back",
    "input": "Back",
    "cloze": "Extra",
    "hierarchy": "Answer",
}


def _apply_front_tts(qfmt, model_type, lang):
    """
    Prepend `{{tts <lang>:<Field>}}` to the front template for basic, input, and cloze
    models. Anki parses TTS tags at template-compile time, so the lang code has to be
    embedded directly into the template string at build time (same constraint as MCQ).
    """
    field = _FRONT_FIELD_BY_MODEL.get(model_type)
    if not field or not lang:
        return qfmt
    return f"{{{{tts {lang}:{field}}}}}\n" + qfmt


def _apply_back_tts(afmt, model_type, lang):
    """
    Prepend `{{tts <lang>:<Field>}}` to the back/answer template for basic, input, and
    cloze models. basic/input read the `Back` field, cloze reads the `Extra` field.
    Same compile-time constraint as `_apply_front_tts`.
    """
    field = _BACK_FIELD_BY_MODEL.get(model_type)
    if not field or not lang:
        return afmt
    return f"{{{{tts {lang}:{field}}}}}\n" + afmt


_MANUAL_TTS_SIDES = ("front", "back", "both")


def resolve_tts_langs(settings):
    """
    Resolve the effective front/back TTS lang codes for non-MCQ cards from deck settings.

    A manual language pick (`ttsManualLang` + `ttsManualSide`) takes precedence over
    auto-detect (`frontLang`). When a manual language is set, the side drives which
    template carries it: 'front', 'back', or 'both'. With no manual language, auto-detect
    drives the front only, preserving the prior behaviour.

    Returns a (front_lang, back_lang) tuple.
    """
    manual_lang = settings.get("ttsManualLang", "") or ""
    if manual_lang:
        side = settings.get("ttsManualSide", "front") or "front"
        if side not in _MANUAL_TTS_SIDES:
            side = "front"
        front = manual_lang if side in ("front", "both") else ""
        back = manual_lang if side in ("back", "both") else ""
        return front, back
    return settings.get("frontLang", "") or "", ""


def get_model(descriptor, mcq_settings=None, front_lang="", back_lang=""):
    """
    load the correct model based on type
    :param descriptor:
    :param mcq_settings: optional dict of MCQ user settings (only used for mcq model type)
    :param front_lang: optional Anki TTS lang code (e.g. 'ja', 'zh', 'ko', 'en') to inject
        on the front of non-MCQ cards. Empty string means no injection.
    :param back_lang: optional Anki TTS lang code to inject on the back of non-MCQ cards.
        Empty string means no injection. 'both' is front_lang and back_lang sharing a value.
    :return:
    """
    model_type, model_id, name, css, qfmt, afmt = descriptor
    model_info = MODEL_INFO[model_type]
    template_file = get_template(model_info.get("file_name"))

    if qfmt is None:
        qfmt = template_file.get('front')
    if afmt is None:
        afmt = template_file.get('back')

    if not css:
        css = template_file.get('styling') or ''

    if model_type == "mcq" and mcq_settings:
        qfmt, afmt = _apply_mcq_settings(qfmt, afmt, mcq_settings)
    else:
        qfmt = _apply_front_tts(qfmt, model_type, front_lang)
        afmt = _apply_back_tts(afmt, model_type, back_lang)

    return N2AModel(
        model_id, name,
        fields=template_file.get("fields"),
        templates=[
            {
                "name": name,
                "qfmt": qfmt,
                "afmt": afmt,
            },
        ],
        css=css,
        model_type=model_info.get("model_type"),
    )


def get_custom_model(model_name, field_names, is_cloze, css):
    """
    Build a genanki Model that preserves the user's original note-type
    structure. Used by the apkg-input transform pipeline when the source
    deck has fields beyond Front/Back — we keep all of them so the
    transformed deck round-trips cleanly into Anki.

    model_name: the original note-type name from the uploaded deck
    field_names: ordered list of field names from the source note type
    is_cloze: True if the original model was a Cloze note type
    css: stylesheet to apply (typically BASIC_STYLE or CLOZE_STYLE)
    """
    if not field_names:
        field_names = ["Front", "Back"]

    safe_id = get_model_id(model_name)
    safe_fields = [{"name": name} for name in field_names]
    first = field_names[0]
    remaining = field_names[1:]

    if is_cloze:
        qfmt = f"{{{{cloze:{first}}}}}"
        afmt_parts = [f"{{{{cloze:{first}}}}}"]
        for name in remaining:
            afmt_parts.append(f"<br>{{{{{name}}}}}")
        afmt = "".join(afmt_parts)
        model_type = Model.CLOZE
    else:
        qfmt = f"{{{{{first}}}}}"
        afmt_parts = ['{{FrontSide}}<hr id="answer">']
        for name in remaining:
            afmt_parts.append(f"<br>{{{{{name}}}}}")
        afmt = "".join(afmt_parts)
        model_type = Model.FRONT_BACK

    return N2AModel(
        safe_id,
        model_name,
        fields=safe_fields,
        templates=[
            {
                "name": model_name,
                "qfmt": qfmt,
                "afmt": afmt,
            },
        ],
        css=css,
        model_type=model_type,
    )
