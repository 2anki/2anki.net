#!/usr/bin/env python3
import importlib.util
import os
import unittest

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "hard_rails", os.path.join(HOOKS_DIR, "hard_rails.py")
)
rails = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rails)


class TestRailPaths(unittest.TestCase):
    def test_clean_pr_has_no_rails(self):
        paths = [
            "src/lib/parser/DeckParser.ts",
            "web/src/pages/HomePage/HomePage.tsx",
            "web/src/pages/WhatsNewPage/changelog/2026-08-26-thing.json",
            "README.md",
        ]
        self.assertEqual(rails.rail_paths(paths), [])

    def test_name_glob_hits_any_segment_case_insensitive(self):
        paths = [
            "src/controllers/StripeController/StripeController.ts",
            "src/routes/middleware/RequireAuthentication.ts",
            "src/usecases/checkout/AutoSyncCheckoutUseCase.ts",
            "web/src/pages/PricingPage/PricingPage.tsx",
            "src/lib/ankify/notionWebhookSignature.ts",
            "src/usecases/users/CheckMonthlyCardLimitUseCase.ts",
            "src/usecases/passes/ClaimPassUseCase.ts",
        ]
        self.assertEqual(rails.rail_paths(paths), paths)

    def test_name_glob_hits_test_files_too(self):
        paths = ["src/routes/CheckoutRouter.test.ts"]
        self.assertEqual(rails.rail_paths(paths), paths)

    def test_explicit_prefixes(self):
        paths = [
            "migrations/20261012000000_add_thing.js",
            "src/data_layer/public/Users.ts",
            ".github/workflows/deploy.2anki.net.yml",
            ".github/dependabot.yml",
            ".github/actions/setup/action.yml",
            "scripts/deploy-blue-green.sh",
            ".claude/hooks/safety.py",
            ".claude/commands/ship.md",
            ".claude/agents/engineer.md",
            ".claude/docs/autonomous-shipping.md",
            ".claude/settings.local.json",
            "src/services/EmailService/templates/subscription-cancelled.html",
            "src/services/EmailService/templates/abandoned-checkout-recovery.html",
        ]
        self.assertEqual(rails.rail_paths(paths), paths)

    def test_explicit_files(self):
        paths = [
            "ecosystem.blue-green.config.js",
            "CLAUDE.md",
            "src/server.ts",
            "src/lib/isPaying.ts",
            "src/lib/ankify/access.ts",
        ]
        self.assertEqual(rails.rail_paths(paths), paths)

    def test_only_the_matching_paths_are_returned(self):
        paths = ["src/lib/parser/DeckParser.ts", "src/lib/isPaying.ts"]
        self.assertEqual(rails.rail_paths(paths), ["src/lib/isPaying.ts"])

    def test_non_rail_neighbours_of_explicit_files_stay_clean(self):
        paths = [
            "src/lib/isPayingBanner.tsx",
            "src/lib/parser/CLAUDE.md",
            "src/servers.ts",
            "scripts/reap-orphans.sh",
            "src/services/EmailService/templates/welcome.html",
        ]
        self.assertEqual(rails.rail_paths(paths), [])


class TestContentTriggers(unittest.TestCase):
    def test_changed_line_with_trigger_is_reported(self):
        diff = "\n".join([
            "--- a/src/lib/foo.ts",
            "+++ b/src/lib/foo.ts",
            "-const x = 1;",
            "+const x = process.env.AUTO_SYNC_PRODUCT_ID;",
        ])
        self.assertEqual(rails.rail_content_hits(diff), ["AUTO_SYNC_PRODUCT_ID"])

    def test_removed_line_with_trigger_is_reported(self):
        diff = "-  max_memory_restart: '2G',\n+  restart_delay: 100,"
        self.assertEqual(rails.rail_content_hits(diff), ["max_memory_restart"])

    def test_context_line_does_not_count(self):
        diff = " const limit = process.env.SECRET;\n+const other = 1;"
        self.assertEqual(rails.rail_content_hits(diff), [])

    def test_each_trigger_reported_once(self):
        diff = "+a max-old-space-size\n+b max-old-space-size\n+process.env.SECRET"
        self.assertEqual(
            rails.rail_content_hits(diff), ["max-old-space-size", "process.env.SECRET"]
        )

    def test_paid_quota_constants_are_triggers(self):
        diff = "-const SUBSCRIBER_MAP_LIMIT = 25;\n+const SUBSCRIBER_MAP_LIMIT = 250;"
        self.assertEqual(rails.rail_content_hits(diff), ["SUBSCRIBER_MAP_LIMIT"])


if __name__ == "__main__":
    unittest.main()
