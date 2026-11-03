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


def run(lines, *args):
    with tempfile.TemporaryDirectory() as logs:
        with open(os.path.join(logs, "server-blue-out.log"), "w") as f:
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
        recent = stamp(1)
        hour = recent[:13]
        lines = [
            memory(stamp(1, 1), 2),
            memory(stamp(1, 2), 12, interactive=1),
            memory(stamp(1, 3), 4, interactive=2),
            *[f'{stamp(1, 4)}: 1.2.3.4 - - [x] "GET /api/upload/jobs HTTP/1.1" - - "-" "ua"'] * 11,
            f"{stamp(1, 5)}: [conversion-pool] stall upload waited 130s",
            f"{stamp(1, 6)}: tempfile dwellMs: 125000",
            f"{stamp(1, 7)}: tempfile dwellMs: 900",
            request(stamp(1, 8), "/api/apkg/pdf", 500),
            request(stamp(1, 9), "/api/apkg/pdf", 200),
        ]
        out = run(lines)

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stderr, "")
        self.assertEqual(section(out.stdout, "max pool_queue"), [f"{hour} 12"])
        self.assertEqual(section(out.stdout, "pool_queue_interactive"), [f"2 {hour}"])
        self.assertEqual(section(out.stdout, "no-response"), [f"11 {hour}"])
        self.assertEqual(section(out.stdout, "stall lines"), ["1"])
        self.assertEqual(section(out.stdout, "max tempfile dwell"), ["125000"])
        self.assertEqual(section(out.stdout, "PDF 500s"), ["1"])

    def test_ignores_lines_older_than_the_window(self):
        lines = [
            memory(stamp(30), 50, interactive=3),
            f"{stamp(30, 1)}: [conversion-pool] stall upload waited 130s",
            memory(stamp(1), 0),
        ]
        out = run(lines)

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stderr, "")
        self.assertEqual(section(out.stdout, "max pool_queue"), [])
        self.assertEqual(section(out.stdout, "pool_queue_interactive"), [])
        self.assertEqual(section(out.stdout, "stall lines"), ["0"])

    def test_hours_argument_widens_the_window(self):
        lines = [f"{stamp(30, 1)}: [conversion-pool] stall upload waited 130s"]
        out = run(lines, "48")

        self.assertEqual(section(out.stdout, "stall lines"), ["1"])
        self.assertIn("last 48h", out.stdout)


if __name__ == "__main__":
    unittest.main()
