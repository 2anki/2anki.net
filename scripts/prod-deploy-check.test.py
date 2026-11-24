"""Tests for scripts/prod-deploy-check.sh. Run: python3 scripts/prod-deploy-check.test.py"""

import os
import re
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "prod-deploy-check.sh")
ERRORS_SCRIPT = os.path.join(HERE, "prod-errors.sh")

SECRETS = [
    "grace.hopper@example.com",
    "example.com",
    "203.0.113.50",
    "2001:db8::7",
    "Bearer zyx987WVU654tsr321",
    "zyx987WVU654tsr321",
    "code=4f3e2d1c",
    "Organic Chemistry",
    ".apkg",
    "cs_live_a1B2c3D4e5F6g7H8",
]


def ts(minute, second=0):
    return f"2026-01-31T10:{minute:02d}:{second:02d}.000+00:00"


def access(stamp, method, path, status):
    return f'{stamp}: 203.0.113.50 - - [31/Jan/2026:10:00:00 +0000] "{method} {path} HTTP/1.1" {status} 12 "-" "Mozilla/5.0"'


def run(*args, out=(), error=()):
    with tempfile.TemporaryDirectory() as logs:
        for name, lines in (("server-green-out.log", out), ("server-green-error.log", error)):
            with open(os.path.join(logs, name), "w") as f:
                f.write("\n".join(lines) + ("\n" if lines else ""))
        with open(SCRIPT) as source:
            return subprocess.run(
                ["bash", "-s", "--", *args],
                stdin=source,
                capture_output=True,
                text=True,
                env={**os.environ, "PROD_CHECK_LOG_DIR": logs},
            )


def section(output, title):
    lines = output.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(f"== {title}"))
    body = []
    for line in lines[start + 1 :]:
        if line.startswith("== "):
            break
        body.append(" ".join(line.split()))
    return body


def filter_block(path):
    with open(path) as f:
        return re.search(r"<<'PERL'\n(.*?)\nPERL\n", f.read(), re.S).group(1)


def traffic():
    return [
        access(ts(1), "POST", "/api/upload/file", 200),
        access(ts(2), "POST", "/api/upload/file?code=4f3e2d1c", 200),
        access(ts(3), "POST", "/api/upload/file", 500),
        access(ts(4), "POST", "/api/upload/claim", 200),
        access(ts(5), "POST", "/api/upload/claim/pass", 409),
        access(ts(6), "POST", "/api/checkout/session", 200),
        access(ts(7), "POST", "/webhook", 200),
        access(ts(8), "POST", "/webhook", 400),
        access(ts(9), "POST", "/api/users/login", 401),
        access(ts(10), "POST", "/api/users/magic-link", 200),
        access(ts(11), "GET", "/api/users/magic/0a1b2c3d4e5f60718293a4b5c6d7e8f9", 302),
        access(ts(12), "GET", "/api/download/Organic%20Chemistry.apkg", 502),
        access(ts(13), "GET", "/", 200),
    ]


class DeployCheckTest(unittest.TestCase):
    def test_counts_statuses_for_each_watched_route(self):
        out = run("2026-01-31T10:00", out=traffic())

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(
            section(out.stdout, "status by route"),
            [
                "upload: 200=2 500=1",
                "claim: 200=1 409=1",
                "checkout: 200=1",
                "webhook: 200=1 400=1",
                "sign-in: 200=1 302=1 401=1",
            ],
        )

    def test_counts_5xx_and_names_their_routes_without_the_file_name(self):
        out = run("2026-01-31T10:00", out=traffic())

        self.assertIn("== 5xx: 2", out.stdout)
        self.assertEqual(sorted(section(out.stdout, "5xx:")), ["1 GET /api/download/<file> 502", "1 POST /api/upload/file 500"])

    def test_prints_a_route_with_no_traffic_as_none(self):
        out = run("2026-01-31T10:00", out=[access(ts(1), "GET", "/", 200)])

        self.assertEqual(section(out.stdout, "status by route")[0], "upload: none")

    def test_masks_crash_lines(self):
        errors = [
            f"{ts(20)}: Uncaught Error: checkout failed for grace.hopper@example.com from 2001:db8::7 session cs_live_a1B2c3D4e5F6g7H8",
            f"{ts(21)}: FATAL headers authorization: Bearer zyx987WVU654tsr321 file 'Organic Chemistry.apkg'",
        ]
        out = run("2026-01-31T10:00", out=traffic(), error=errors)

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("== crashes: 2", out.stdout)
        self.assertEqual(
            section(out.stdout, "crashes"),
            [
                "2026-01-31T10:20 Uncaught Error: checkout failed for <email> from <ip> session cs_<id>",
                "2026-01-31T10:21 FATAL headers authorization: <secret> <token> file '<file>'",
            ],
        )
        for secret in SECRETS:
            self.assertNotIn(secret, out.stdout)

    def test_counts_only_lines_since_the_start(self):
        old = [access("2026-01-31T09:59:59.000+00:00", "POST", "/api/upload/file", 500)]
        out = run("2026-01-31T10:00:00Z", out=old + [access(ts(1), "POST", "/api/upload/file", 200)])

        self.assertIn("1 lines", out.stdout)
        self.assertIn("== 5xx: 0", out.stdout)
        self.assertEqual(section(out.stdout, "status by route")[0], "upload: 200=1")

    def test_fails_loudly_when_the_window_is_empty(self):
        out = run("2026-01-31T10:00", out=[])

        self.assertEqual(out.returncode, 3)
        self.assertIn("nothing to read", out.stderr)
        self.assertNotIn("== status by route", out.stdout)

    def test_refuses_a_start_that_is_not_a_utc_date_time(self):
        for args in ((), ("1",), ("2026-01-31",), ("2026-01-31T10:00-05:00",), ("`id`",), ("a", "b")):
            with self.subTest(args=args):
                out = run(*args, out=traffic())
                self.assertEqual(out.returncode, 2)
                self.assertEqual(out.stdout, "")

    def test_masks_with_the_same_filter_as_prod_errors(self):
        self.assertEqual(filter_block(SCRIPT), filter_block(ERRORS_SCRIPT))


if __name__ == "__main__":
    unittest.main()
