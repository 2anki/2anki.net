from backend.utils.email_error_alert import operator_error_report

USER_FILE = "/tmp/io-1234/Cardiac Anatomy Midterm.png"


def _raise_with_user_file():
    raise FileNotFoundError(f"[Errno 2] No such file or directory: '{USER_FILE}'")


def _caught():
    try:
        _raise_with_user_file()
    except FileNotFoundError as error:
        return error
    raise AssertionError("expected an error")


def test_report_leaves_out_the_error_message_and_user_file_names(monkeypatch):
    monkeypatch.setenv("TWOANKI_REQUEST_ID", "req-42")

    subject, body = operator_error_report("IO deck", _caught())

    assert subject == "[ERROR] [2anki.net] IO deck - FileNotFoundError"
    assert "Cardiac Anatomy" not in subject + body
    assert "/tmp/io-1234" not in subject + body
    assert "Error kind: FileNotFoundError" in body
    assert "Reference: req-42" in body
    assert "in _raise_with_user_file" in body


def test_report_says_unknown_when_no_reference_was_passed(monkeypatch):
    monkeypatch.delenv("TWOANKI_REQUEST_ID", raising=False)

    _subject, body = operator_error_report("deck writer", _caught())

    assert "Reference: unknown" in body
