"""Tests for scripts/prod-errors.sh. Run: python3 scripts/prod-errors.test.py"""

import os
import stat
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prod-errors.sh")

SECRETS = [
    "ada.lovelace@example.com",
    "example.com",
    "203.0.113.7",
    "198.51.100.23",
    "2001:db8::42",
    "192.0.2.9",
    "abcDEF123456ghiJKL789xyz",
    "session=abc123def",
    "ref=",
    "Lecture Notes Week",
    ".pdf",
    "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0NTY3ODk",
    "cus_Q8xY2zAbCdEf12",
    "9f8e7d6c5b4a39281706f5e4d3c2b1a0",
    "hunter2pass",
    "Biology",
    "48213",
    "lovelace",
    "Zm9vOmJhcg",
    "Zm9v ",
    "q9w8e7",
    "z1x2c3",
    "r3s3tvalue",
    "k3yvalue",
    "pw-value",
    "N9qo8uLOickgx2ZMRZoMye",
    "Ada",
    "Organic",
    "Week 3",
    "cus_abcdefghijklmnop",
    "rk55z",
    "sh44y",
    "vf33x",
    "Chemistry",
]

PM2_TABLE = """\
┌────┬──────────────┬─────────┬─────────┬──────────┬────────┐
│ id │ name         │ mode    │ ↺       │ status   │ memory │
├────┼──────────────┼─────────┼─────────┼──────────┼────────┤
│ 0  │ pm2-logrotate │ fork   │ 0       │ online   │ 40mb   │
│ 3  │ server-blue  │ fork    │ 2       │ online   │ 400mb  │
└────┴──────────────┴─────────┴─────────┴──────────┴────────┘
"""


def ts(minute, second=0, hour=10):
    return f"2026-01-31T{hour:02d}:{minute:02d}:{second:02d}.000+00:00"


def access(stamp, method, path, status, referrer="-"):
    return f'{stamp}: 203.0.113.7 - - [31/Jan/2026:10:00:00 +0000] "{method} {path} HTTP/1.1" {status} 12 "{referrer}" "Mozilla/5.0"'


def sensitive_out():
    return [
        access(ts(5), "POST", "/api/upload/file?session=abc123def", 500, "https://2anki.net/upload?ref=ada.lovelace@example.com"),
        access(ts(6), "GET", "/api/users/magic/9f8e7d6c5b4a39281706f5e4d3c2b1a0", 502),
        access(ts(7), "GET", "/api/download/Lecture%20Notes%20Week%203.pdf", 503),
        access(ts(7, 30), "GET", "/api/share/Biology%20Week%202", 500),
        access(ts(7, 40), "GET", "/api/decks/Chemistry%20Unit%201/cards", 500),
        access(ts(7, 45), "GET", "/api/users/reset/rk55z", 500),
        access(ts(7, 50), "GET", "/share/sh44y", 500),
        access(ts(7, 55), "GET", "/api/users/verify/vf33x", 500),
        f"{ts(8)}: [checkout] checkout.session_completed for ada.lovelace@example.com customer cus_Q8xY2zAbCdEf12",
        f"{ts(9)}: pass.granted user 48213 from ::ffff:192.0.2.9",
        f"{ts(10)}: [memory] rss_mb=400 heap_used_mb=200 pool_queue=0",
    ]


def sensitive_error():
    return [
        f"{ts(5, 30)}: [upload] could not store the upload {{ filename: 'Lecture Notes Week 3.pdf', email: 'ada.lovelace@example.com', ip: '198.51.100.23' }}",
        f"{ts(6, 30)}: Error: request failed authorization: Bearer abcDEF123456ghiJKL789xyz from 2001:db8::42",
        f"{ts(7, 30)}: Uncaught TypeError: cannot read x for cus_Q8xY2zAbCdEf12 token=QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0NTY3ODk=",
        f"{ts(8, 30)}: connect failed postgres://app:hunter2pass@db.example.com/app",
        f"{ts(9, 30)}: [upload] tempfile read {{ firstFile: 'Lecture Notes Week 3.pdf', readMs: 12 }}",
        f"{ts(10, 30)}: login failed for ada.lovelace%40example.com Authorization: Basic Zm9v",
        f"{ts(10, 40)}: proxy said authorization: Basic Zm9vOmJhcg==",
        f"{ts(11, 30)}: headers cookie: connect.sid=s%3Aq9w8e7.r6t5; sid=z1x2c3 reset_token=r3s3tvalue stripe_key=k3yvalue password_reset: 'pw-value'",
        f"{ts(12, 30)}: stored hash $2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy for login",
        f"{ts(13, 30)}: sync failed {{ name: 'Ada Lovelace', deck: 'Organic Notes', deckName: 'Organic Notes II', title: 'Week 3' }}",
        f"{ts(13, 40)}: sync owner {{ customer_name: 'Ada L', workspace_name: 'Ada Lab', originalname: 'notes', email: 'someone@example.com' }}",
        f"{ts(13, 50)}: sync billing {{ customer: 'cus_abcdefghijklmnop', status: 'in_progress' }}",
    ]


def write_lines(path, lines):
    with open(path, "w") as f:
        f.write("\n".join(lines) + ("\n" if lines else ""))


def run(*args, out=(), error=(), extra_files=(), script=SCRIPT):
    with tempfile.TemporaryDirectory() as root:
        logs = os.path.join(root, "logs")
        bin_dir = os.path.join(root, "bin")
        os.makedirs(logs)
        os.makedirs(bin_dir)
        pm2 = os.path.join(bin_dir, "pm2")
        with open(pm2, "w") as f:
            f.write("#!/bin/sh\ncat <<'EOF'\n" + PM2_TABLE + "EOF\n")
        os.chmod(pm2, os.stat(pm2).st_mode | stat.S_IEXEC)
        for name, lines in (("server-blue-out.log", out), ("server-blue-error.log", error), *extra_files):
            write_lines(os.path.join(logs, name), lines)
        with open(script) as source:
            return subprocess.run(
                ["bash", "-s", "--", *args],
                stdin=source,
                capture_output=True,
                text=True,
                env={**os.environ, "PROD_CHECK_LOG_DIR": logs, "PATH": bin_dir + os.pathsep + os.environ["PATH"]},
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


class MaskingTest(unittest.TestCase):
    def test_no_personal_data_or_secret_leaves_the_box(self):
        out = run("2026-01-31T10:00", out=sensitive_out(), error=sensitive_error())

        self.assertEqual(out.returncode, 0, out.stderr)
        for secret in SECRETS:
            self.assertNotIn(secret, out.stdout)
            self.assertNotIn(secret, out.stderr)

    def test_masks_with_named_placeholders_so_the_shape_stays_readable(self):
        out = run("2026-01-31T10:00", out=sensitive_out(), error=sensitive_error())

        collapsed = "\n".join(section(out.stdout, "error log, collapsed"))
        for expected in (
            "filename: <name>, email: <name>, ip: '<ip>'",
            "authorization: <secret> from <ip>",
            "postgres://<cred>@<host>/app",
            "cus_<id> token=<secret>",
            "firstFile: <name>",
            "login failed for <email> Authorization: <secret>",
            "proxy said authorization: <secret>",
            "cookie: <secret>; sid=<secret> reset_token=<secret> stripe_key=<secret> password_reset: <secret>",
            "stored hash <hash> for login",
            "name: <name>, deck: <name>, deckName: <name>, title: <name> }",
            "customer_name: <name>, workspace_name: <name>, originalname: <name>, email: <name> }",
            "customer: 'cus_<id>', status: 'in_progress' }",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, collapsed)

    def test_5xx_routes_drop_the_query_and_mask_tokens_and_names(self):
        out = run("2026-01-31T10:00", out=sensitive_out(), error=sensitive_error())

        self.assertEqual(
            sorted(section(out.stdout, "5xx by route")),
            [
                "1 GET /api/decks/<enc>/cards 500",
                "1 GET /api/download/<file> 503",
                "1 GET /api/share/<tok> 500",
                "1 GET /api/users/magic/<tok> 502",
                "1 GET /api/users/reset/<tok> 500",
                "1 GET /api/users/verify/<tok> 500",
                "1 GET /share/<tok> 500",
                "1 POST /api/upload/file 500",
            ],
        )

    def test_events_are_counted_by_key_only(self):
        out = run("2026-01-31T10:00", out=sensitive_out(), error=sensitive_error())

        self.assertEqual(
            sorted(section(out.stdout, "checkout, pass, webhook and credit events")),
            ["1 checkout.session_completed", "1 pass.granted"],
        )


class WindowTest(unittest.TestCase):
    def test_counts_only_lines_at_or_after_the_start(self):
        out_lines = [access(ts(29), "GET", "/", 200), access(ts(30), "GET", "/", 200), access(ts(31), "GET", "/", 404)]
        errors = [f"{ts(29)}: Uncaught Error: before", f"{ts(31)}: Uncaught Error: after"]
        out = run("2026-01-31T10:30", out=out_lines, error=errors)

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("2 out lines, 1 error lines", out.stdout)
        self.assertEqual(section(out.stdout, "status mix"), ["1 2xx", "1 4xx"])
        self.assertIn("== crashes: 1", out.stdout)
        self.assertNotIn("before", out.stdout)

    def test_a_start_to_the_second_excludes_earlier_lines_in_that_minute(self):
        errors = [f"{ts(30, 5)}: Uncaught Error: early", f"{ts(30, 20)}: Uncaught Error: late"]
        out = run("2026-01-31T10:30:12Z", out=[], error=errors)

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("since 2026-01-31T10:30:12 UTC", out.stdout)
        self.assertEqual(section(out.stdout, "crashes"), ["2026-01-31T10:30 Uncaught Error: late"])

    def test_ignores_untimestamped_continuation_lines(self):
        out = run("2026-01-31T10:00", out=[access(ts(1), "GET", "/", 200), "    at secret continuation ada.lovelace@example.com"])

        self.assertIn("1 out lines, 0 error lines", out.stdout)
        self.assertNotIn("continuation", out.stdout)

    def test_last_crashes_are_the_latest_by_time_across_files(self):
        current = [f"{ts(20 + i)}: Uncaught Error: current {i}" for i in range(5)]
        rotated = ("server-green-error__2026-01-31_10-19-00.log", [f"{ts(10 + i)}: Uncaught Error: rotated {i}" for i in range(5)])
        out = run("2026-01-31T10:00", out=[], error=current, extra_files=(rotated,))

        crashes = section(out.stdout, "crashes")
        self.assertIn("== crashes: 10", out.stdout)
        self.assertEqual(len(crashes), 8)
        self.assertEqual(crashes[0], "2026-01-31T10:12 Uncaught Error: rotated N")
        self.assertEqual(crashes[-1], "2026-01-31T10:24 Uncaught Error: current N")

    def test_memory_shows_the_latest_three_samples_with_numbers(self):
        samples = [f"{ts(i)}: [memory] rss_mb={400 + i} pool_queue=0" for i in range(1, 6)]
        out = run("2026-01-31T10:00", out=list(reversed(samples)))

        self.assertEqual(
            section(out.stdout, "memory"),
            [f"2026-01-31T10:0{i} [memory] rss_mb={400 + i} pool_queue=0" for i in (3, 4, 5)],
        )

    def test_lists_the_app_processes_from_pm2(self):
        out = run("2026-01-31T10:00", out=[access(ts(1), "GET", "/", 200)])

        processes = section(out.stdout, "pm2 processes")
        self.assertEqual(len(processes), 2)
        self.assertIn("server-blue", processes[1])

    def test_fails_loudly_when_the_window_is_empty(self):
        out = run("2026-01-31T10:00", out=[access("2026-01-30T10:00:00.000+00:00", "GET", "/", 200)])

        self.assertEqual(out.returncode, 3)
        self.assertIn("0 out lines, 0 error lines", out.stdout)
        self.assertIn("nothing to read", out.stderr)
        self.assertNotIn("== crashes", out.stdout)


class ArgumentTest(unittest.TestCase):
    def test_accepts_iso_date_times(self):
        for start in ("2026-01-31T10:00", "2026-01-31T10:00:12Z", "2026-01-31T10:00:12.345+00:00", "2026-01-31T10:00Z"):
            with self.subTest(start=start):
                out = run(start, out=[access(ts(30), "GET", "/", 200)])
                self.assertEqual(out.returncode, 0, out.stderr)

    def test_refuses_anything_that_is_not_a_utc_date_time(self):
        for args in (
            (),
            ("",),
            ("24",),
            ("2026-01-31",),
            ("2026-01-31T10",),
            ("2026-01-31T24:00",),
            ("2026-13-01T10:00",),
            ("2026-01-31T10:00+02:00",),
            ("2026-01-31T10:00; echo owned",),
            ("$(id)",),
            ("2026-01-31T10:00\n2026",),
            ("2026-01-31T10:00", "extra"),
        ):
            with self.subTest(args=args):
                out = run(*args, out=[access(ts(30), "GET", "/", 200)])
                self.assertEqual(out.returncode, 2)
                self.assertEqual(out.stdout, "")
                self.assertIn("usage:", out.stderr)


if __name__ == "__main__":
    unittest.main()
