"""Tests for scripts/stall-read.sh. Run: python3 scripts/stall-read.test.py"""

import datetime
import os
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stall-read.sh")


def stamp(hours_ago, minute=0):
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours_ago)
    return t.replace(minute=minute, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%S.000+00:00")


def memory(ts, queue, interactive=0):
    return f"{ts}: [memory] rss_mb=400 pool_queue={queue} pool_utilization=0 pool_queue_interactive={interactive}"


def request(ts, path, status):
    return f'{ts}: 1.2.3.4 - - [x] "POST {path} HTTP/1.1" {status} 10 "-" "ua"'


def stall(ts):
    return f"{ts}: [conversion-pool] stall oldest_wait_s=130 queue=4 busy_background=2"


def no_response(ts):
    return f'{ts}: 1.2.3.4 - - [x] "GET /api/upload/jobs HTTP/1.1" - - "-" "ua"'


def run(out_lines, error_lines=(), *args, green_out=()):
    with tempfile.TemporaryDirectory() as logs:
        files = (
            ("server-blue-out.log", out_lines),
            ("server-blue-error.log", error_lines),
            ("server-green-out.log", green_out),
        )
        for name, lines in files:
            with open(os.path.join(logs, name), "w") as f:
                f.write("\n".join(lines) + "\n")
        with open(SCRIPT) as script:
            return subprocess.run(
                ["bash", "-s", "--", *args],
                stdin=script,
                capture_output=True,
                text=True,
                env={**os.environ, "STALL_LOG_DIR": logs},
            )


def section(output, title):
    lines = output.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(f"== {title}"))
    body = []
    for line in lines[start + 1 :]:
        if line.startswith("== "):
            break
        body.append(line.strip())
    return body


class StallReadTest(unittest.TestCase):
    def test_reports_each_signal_from_recent_lines(self):
        hour = stamp(1)[:13]
        quiet_hour = stamp(3)[:13]
        out_lines = [
            memory(stamp(1, 1), 2),
            memory(stamp(1, 2), 12, interactive=1),
            memory(stamp(1, 3), 4, interactive=2),
            *[no_response(stamp(1, 4))] * 11,
            *[no_response(stamp(3, 4))] * 9,
            f"{stamp(1, 6)}: [upload] tempfile dwell {{ dwellMs: 125000, fileCount: 1 }}",
            f"{stamp(1, 7)}: [upload] tempfile dwell {{ dwellMs: 900, fileCount: 1 }}",
            request(stamp(1, 8), "/api/apkg/pdf", 500),
            request(stamp(1, 9), "/api/apkg/pdf", 200),
        ]
        cleared = f"{stamp(1, 6)}: [conversion-pool] stall cleared after 40s"
        out = run(out_lines, [stall(stamp(1, 5)), cleared])

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stderr, "")
        self.assertEqual(section(out.stdout, "max pool_queue"), [f"{hour} 12"])
        self.assertEqual(section(out.stdout, "longest pool_queue_interactive"), [f"blue {stamp(1, 2)[:16]} 2"])
        self.assertEqual(section(out.stdout, "no-response"), [f"11 {hour}"])
        self.assertNotIn(quiet_hour, out.stdout)
        self.assertEqual(section(out.stdout, "stall lines"), ["1"])
        self.assertEqual(section(out.stdout, "max tempfile dwell"), ["125000"])
        self.assertEqual(section(out.stdout, "PDF 500s"), ["1"])

    def test_ignores_lines_older_than_the_window(self):
        out_lines = [memory(stamp(30), 50, interactive=3), memory(stamp(1), 0), "{ untimestamped: 'continuation' }"]
        out = run(out_lines, [stall(stamp(30, 1))])

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stderr, "")
        self.assertEqual(section(out.stdout, "max pool_queue"), [])
        self.assertEqual(section(out.stdout, "longest pool_queue_interactive"), [])
        self.assertEqual(section(out.stdout, "stall lines"), ["0"])
        self.assertIn(", 1 lines", out.stdout)

    def test_interactive_streak_needs_consecutive_samples_from_one_color(self):
        blue = [memory(stamp(1, 5), 1, interactive=1), memory(stamp(1, 45), 1, interactive=1)]
        green = [memory(stamp(1, 6), 1, interactive=1)]
        out = run(blue, [], green_out=green)

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(
            section(out.stdout, "longest pool_queue_interactive"),
            [f"blue {stamp(1, 5)[:16]} 1", f"green {stamp(1, 6)[:16]} 1"],
        )

    def test_hours_argument_widens_the_window(self):
        out = run([], [stall(stamp(30, 1))], "48")

        self.assertEqual(section(out.stdout, "stall lines"), ["1"])
        self.assertIn("last 48h", out.stdout)

    def test_fails_loudly_when_the_window_is_empty(self):
        out = run([memory(stamp(30), 0)], [])

        self.assertEqual(out.returncode, 3)
        self.assertIn("0 lines", out.stdout)
        self.assertIn("no log lines in the window", out.stderr)
        self.assertNotIn("== stall lines", out.stdout)

    def test_rejects_hours_that_are_not_a_number(self):
        out = run([], [], "24h")

        self.assertEqual(out.returncode, 2)
        self.assertEqual(out.stdout, "")


if __name__ == "__main__":
    unittest.main()
