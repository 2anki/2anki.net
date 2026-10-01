#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location(
    "cap", pathlib.Path(__file__).parent / "check-pr-body-length.py"
)
cap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cap)


class TestProseWords(unittest.TestCase):
    def test_counts_plain_prose(self):
        self.assertEqual(cap.prose_words("one two three"), 3)

    def test_tables_are_free(self):
        body = "intro words\n| a | b |\n| - | - |\n| 1 | 2 |\n"
        self.assertEqual(cap.prose_words(body), 2)

    def test_code_blocks_are_free(self):
        body = "intro words\n```\nlots of code here\n```\n"
        self.assertEqual(cap.prose_words(body), 2)

    def test_a_tight_body_is_under_the_cap(self):
        body = (
            "## What\nRefuses a checkout for something the account already "
            "owns. Closes #4620.\n\n## Why\nNo entitlement check on any "
            "checkout route, so a lifetime holder could pay again.\n"
        )
        self.assertLess(cap.prose_words(body), cap.WORD_CAP)


class TestBodyExtraction(unittest.TestCase):
    def test_reads_inline_body(self):
        self.assertEqual(
            cap.body_from("gh pr create --body 'hello there'"), "hello there"
        )

    def test_missing_file_is_not_a_crash(self):
        self.assertEqual(cap.body_from("gh pr create --body-file /nope"), "")


if __name__ == "__main__":
    unittest.main()
