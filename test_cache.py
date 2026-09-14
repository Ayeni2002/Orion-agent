"""
Unit tests for the offline cache and the live→cached fallback.

    python test_cache.py

No network, no API key. Uses a temp directory, so it never touches the real
demo/cache/.
"""

import contextlib
import io
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import agent  # noqa: E402
import tools.cache as cache  # noqa: E402
from tools import market_data  # noqa: E402

TOKEN = {"name": "Ethereum", "symbol": "ETH", "price_usd": 2500.0}
ASSESSMENT = {
    "score": 72,
    "verdict": "Promising",
    "key_signals": ["signal"],
    "risk_flags": ["flag"],
    "summary": "summary",
}


def _quiet(fn, *args, **kwargs):
    """Run fn with stdout/stderr swallowed — the CLI is chatty by design."""
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fn(*args, **kwargs)


class CacheTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        patcher = mock.patch.object(cache, "CACHE_DIR", self.tmp)
        patcher.start()
        self.addCleanup(patcher.stop)


class SaveLoadTests(CacheTestCase):
    def test_roundtrip(self):
        cache.save("ethereum", "ethereum", TOKEN, ASSESSMENT)
        entry = cache.load("ethereum")
        self.assertEqual(entry["token_data"]["name"], "Ethereum")
        self.assertEqual(entry["assessment"]["score"], 72)

    def test_unsafe_slug_is_not_stored(self):
        self.assertIsNone(cache.save("../../evil", "../../evil", TOKEN, ASSESSMENT))
        self.assertIsNone(cache.load("../../evil"))
        self.assertEqual(os.listdir(self.tmp), [], "nothing should have been written")

    def test_find_by_id_and_by_alias(self):
        cache.save("pepe", "PEPE", TOKEN, ASSESSMENT)
        self.assertIsNotNone(cache.find("pepe"))
        self.assertIsNotNone(cache.find("  pepe  "), "aliases are normalized")

    def test_aliases_merge_across_repeated_saves(self):
        cache.save("pepe", "pepe", TOKEN, ASSESSMENT)
        cache.save("pepe", "pepe-the-frog", TOKEN, ASSESSMENT)
        self.assertIsNotNone(cache.find("pepe-the-frog"), "the older alias must survive")

    def test_corrupt_entry_is_skipped_not_fatal(self):
        cache.save("ethereum", "ethereum", TOKEN, ASSESSMENT)
        with open(os.path.join(self.tmp, "broken.json"), "w", encoding="utf-8") as f:
            f.write("{not json at all")

        self.assertIsNone(cache.load("broken"))
        self.assertIsNotNone(cache.find("ethereum"), "a bad file must not break the others")

    def test_cached_ids_lists_entries(self):
        cache.save("ethereum", "ethereum", TOKEN, ASSESSMENT)
        cache.save("solana", "solana", TOKEN, ASSESSMENT)
        self.assertEqual(cache.cached_ids(), ["ethereum", "solana"])


class AgeTests(CacheTestCase):
    def _entry(self, delta):
        return {"cached_at_utc": (datetime.now(timezone.utc) - delta).isoformat()}

    def test_less_than_a_minute(self):
        self.assertEqual(cache.age(self._entry(timedelta(seconds=10))), "less than a minute ago")

    def test_minutes(self):
        self.assertEqual(cache.age(self._entry(timedelta(minutes=5))), "5m ago")

    def test_hours_and_minutes(self):
        self.assertEqual(cache.age(self._entry(timedelta(hours=2, minutes=14))), "2h 14m ago")

    def test_days_and_hours(self):
        self.assertEqual(cache.age(self._entry(timedelta(days=3, hours=4))), "3d 4h ago")

    def test_missing_stamp(self):
        self.assertEqual(cache.age({}), "unknown age")

    def test_garbage_stamp(self):
        self.assertEqual(cache.age({"cached_at_utc": "not a date"}), "unknown age")

    def test_naive_stamp_does_not_raise(self):
        naive = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(tzinfo=None)
        self.assertTrue(cache.age({"cached_at_utc": naive.isoformat()}).endswith("ago"))


class FallbackTests(CacheTestCase):
    def test_live_success_caches_for_next_time(self):
        with mock.patch.object(agent, "fetch_token_data", return_value=TOKEN), \
                mock.patch.object(agent.llm, "assess", return_value=ASSESSMENT), \
                mock.patch.object(agent, "load_system_prompt", return_value="prompt"):
            result = _quiet(agent.run, "ethereum")

        self.assertEqual(result["source"], "live")
        self.assertIsNotNone(cache.find("ethereum"), "a live run must be cached")

    def test_falls_back_when_coingecko_fails(self):
        cache.save("ethereum", "ethereum", TOKEN, ASSESSMENT)
        with mock.patch.object(agent, "fetch_token_data", side_effect=market_data.RateLimited("429")):
            result = _quiet(agent.run, "ethereum")

        self.assertEqual(result["source"], "cache")
        self.assertEqual(result["assessment"]["score"], 72)
        self.assertIn("cache_age", result)

    def test_falls_back_when_the_model_call_fails(self):
        # The second network hop is the one people forget to cover.
        cache.save("ethereum", "ethereum", TOKEN, ASSESSMENT)
        with mock.patch.object(agent, "fetch_token_data", return_value=TOKEN), \
                mock.patch.object(agent.llm, "assess", side_effect=RuntimeError("no key")):
            result = _quiet(agent.run, "ethereum")

        self.assertEqual(result["source"], "cache")

    def test_falls_back_when_the_model_key_is_missing(self):
        # LLMError is what llm.assess actually raises for a config problem; it
        # subclasses RuntimeError, so the fallback must still catch it.
        cache.save("ethereum", "ethereum", TOKEN, ASSESSMENT)
        with mock.patch.object(agent, "fetch_token_data", return_value=TOKEN), \
                mock.patch.object(
                    agent.llm, "assess", side_effect=agent.llm.LLMError("no key")
                ):
            result = _quiet(agent.run, "ethereum")

        self.assertEqual(result["source"], "cache")

    def test_no_cache_reraises_the_original_error(self):
        with mock.patch.object(agent, "fetch_token_data", side_effect=market_data.RateLimited("429")):
            with self.assertRaises(market_data.RateLimited):
                _quiet(agent.run, "ethereum")

    def test_offline_never_touches_the_network(self):
        cache.save("ethereum", "ethereum", TOKEN, ASSESSMENT)
        with mock.patch.object(agent, "fetch_token_data", side_effect=AssertionError("network touched!")):
            result = agent.run("ethereum", offline=True)

        self.assertEqual(result["source"], "cache")

    def test_offline_without_cache_explains_itself(self):
        with self.assertRaises(RuntimeError) as ctx:
            agent.run("ethereum", offline=True)
        self.assertIn("No cached run", str(ctx.exception))

    def test_offline_resolves_a_name_alias(self):
        # Offline we cannot search, so only recorded aliases can resolve a name.
        cache.save("pepe", "PEPE", TOKEN, ASSESSMENT)
        result = agent.run("PEPE", offline=True)
        self.assertEqual(result["resolved_id"], "pepe")


class MainTests(CacheTestCase):
    def test_no_args_prints_usage(self):
        self.assertEqual(_quiet(agent.main, []), 1)

    def test_unknown_flag_is_rejected(self):
        self.assertEqual(_quiet(agent.main, ["--bogus", "ethereum"]), 1)

    def test_warm_reports_uncacheable_tokens(self):
        with mock.patch.object(agent, "fetch_token_data", side_effect=market_data.RateLimited("429")):
            self.assertEqual(_quiet(agent.warm, ["ethereum"]), 1)

    def test_warm_succeeds_and_caches(self):
        with mock.patch.object(agent, "fetch_token_data", return_value=TOKEN), \
                mock.patch.object(agent.llm, "assess", return_value=ASSESSMENT), \
                mock.patch.object(agent, "load_system_prompt", return_value="prompt"):
            self.assertEqual(_quiet(agent.warm, ["ethereum", "pepe"]), 0)
        self.assertEqual(cache.cached_ids(), ["ethereum", "pepe"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
