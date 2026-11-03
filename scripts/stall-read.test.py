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


def run(out_lines, error_lines=(), *args, green_out=(), extra_files=()):
    with tempfile.TemporaryDirectory() as logs:
        files = (
            ("server-blue-out.log", out_lines),
            ("server-blue-error.log", error_lines),
            ("server-green-out.log", green_out),
            *extra_files,
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
            *[no_response(stamp(1, 4))] * 10,
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
        self.assertEqual(section(out.stdout, "no-response"), [f"10 {hour}"])
        self.assertNotIn(quiet_hour, out.stdout)
        self.assertEqual(section(out.stdout, "stall lines"), ["1"])
        self.assertEqual(section(out.stdout, "max tempfile dwell"), ["125000"])
        self.assertEqual(section(out.stdout, "PDF 500s"), ["1"])

    def test_pool_queue_prints_hours_peaking_at_three_or_more(self):
        out_lines = [
            memory("2026-01-31T08:10:00.000+00:00", 2),
            memory("2026-01-31T09:10:00.000+00:00", 3),
            memory("2026-01-31T10:10:00.000+00:00", 10),
        ]
        out = run(out_lines, [], "2026-01-31T00")

        self.assertEqual(section(out.stdout, "max pool_queue"), ["2026-01-31T09 3", "2026-01-31T10 10"])

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

    def test_interactive_streak_ends_at_a_zero_sample(self):
        blue = [
            memory(stamp(1, 5), 1, interactive=1),
            memory(stamp(1, 6), 1, interactive=0),
            memory(stamp(1, 7), 1, interactive=1),
        ]
        out = run(blue)

        self.assertEqual(section(out.stdout, "longest pool_queue_interactive"), [f"blue {stamp(1, 5)[:16]} 1"])

    def test_interactive_streak_survives_one_missing_sample(self):
        blue = [memory(stamp(1, 5), 1, interactive=1), memory(stamp(1, 7), 1, interactive=1)]
        out = run(blue)

        self.assertEqual(section(out.stdout, "longest pool_queue_interactive"), [f"blue {stamp(1, 5)[:16]} 2"])

    def test_interactive_streak_runs_across_midnight(self):
        blue = [
            memory("2026-01-31T23:59:00.000+00:00", 1, interactive=1),
            memory("2026-02-01T00:00:00.000+00:00", 1, interactive=2),
        ]
        out = run(blue, [], "2026-01-31T00")

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(section(out.stdout, "longest pool_queue_interactive"), ["blue 2026-01-31T23:59 2"])

    def test_interactive_streak_breaks_on_a_gap_across_midnight(self):
        blue = [
            memory("2026-01-31T23:59:00.000+00:00", 1, interactive=1),
            memory("2026-02-01T00:30:00.000+00:00", 1, interactive=1),
        ]
        out = run(blue, [], "2026-01-31T00")

        self.assertEqual(section(out.stdout, "longest pool_queue_interactive"), ["blue 2026-01-31T23:59 1"])

    def test_interactive_streak_runs_across_new_year(self):
        blue = [
            memory("2025-12-31T23:59:00.000+00:00", 1, interactive=1),
            memory("2026-01-01T00:00:00.000+00:00", 1, interactive=1),
        ]
        out = run(blue, [], "2025-12-31T00")

        self.assertEqual(section(out.stdout, "longest pool_queue_interactive"), ["blue 2025-12-31T23:59 2"])

    def test_interactive_streak_skips_a_second_sample_in_the_same_minute(self):
        blue = [
            memory("2026-01-31T10:00:00.000+00:00", 1, interactive=1),
            memory("2026-01-31T10:00:40.000+00:00", 1, interactive=1),
        ]
        out = run(blue, [], "2026-01-31T00")

        self.assertEqual(section(out.stdout, "longest pool_queue_interactive"), ["blue 2026-01-31T10:00 1"])

    def test_start_argument_counts_only_lines_after_it(self):
        out_lines = [memory("2026-01-31T09:10:00.000+00:00", 0), memory("2026-01-31T09:40:00.000+00:00", 0)]
        errors = [stall("2026-01-31T09:10:00.000+00:00"), stall("2026-01-31T09:40:00.000+00:00")]
        out = run(out_lines, errors, "2026-01-31T09:30")

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("from 2026-01-31T09:30 UTC", out.stdout)
        self.assertEqual(section(out.stdout, "stall lines"), ["1"])

    def test_start_argument_accepts_a_github_timestamp(self):
        out_lines = [memory("2026-01-31T09:29:00.000+00:00", 0), memory("2026-01-31T09:31:00.000+00:00", 0)]
        errors = [stall("2026-01-31T09:29:00.000+00:00"), stall("2026-01-31T09:31:00.000+00:00")]
        out = run(out_lines, errors, "2026-01-31T09:30:12Z")

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("from 2026-01-31T09:30 UTC", out.stdout)
        self.assertEqual(section(out.stdout, "stall lines"), ["1"])

    def test_start_argument_accepts_an_hour_with_a_z(self):
        out = run([memory("2026-01-31T08:59:00.000+00:00", 0), memory("2026-01-31T09:01:00.000+00:00", 0)], [], "2026-01-31T09Z")

        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("from 2026-01-31T09 UTC", out.stdout)
        self.assertIn("1 memory samples", out.stdout)

    def test_header_says_when_the_read_ran(self):
        out = run([memory(stamp(1), 0)])

        now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H")
        self.assertRegex(out.stdout.splitlines()[0], r"until " + now + r":[0-9]{2}\)")

    def test_streak_orders_samples_from_rotated_files(self):
        current = [memory("2026-01-31T10:01:00.000+00:00", 1, interactive=1)]
        rotated = ("server-blue-out__2026-01-31_10-00-30.log", [memory("2026-01-31T10:00:00.000+00:00", 1, interactive=1)])
        out = run(current, [], "2026-01-31T00", extra_files=(rotated,))

        self.assertEqual(section(out.stdout, "longest pool_queue_interactive"), ["blue 2026-01-31T10:00 2"])

    def test_rejects_an_empty_window_argument(self):
        out = run([memory(stamp(1), 0)], [], "")

        self.assertEqual(out.returncode, 2)
        self.assertEqual(out.stdout, "")

    def test_fails_loudly_when_the_out_logs_were_not_read(self):
        out = run([], [stall(stamp(1, 5))])

        self.assertEqual(out.returncode, 4)
        self.assertIn("0 memory samples", out.stdout)
        self.assertIn("out logs were not read", out.stderr)
        self.assertNotIn("== stall lines", out.stdout)

    def test_hours_argument_widens_the_window(self):
        out = run([memory(stamp(1), 0)], [stall(stamp(30, 1))], "48")

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
