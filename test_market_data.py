"""
Unit tests for the CoinGecko client's failure handling.

    python test_market_data.py

No network, no API key. smoke_test.py covers the happy path against the live
API; this covers what the live API won't produce on demand — rate limits,
5xx responses, and backoff behaviour.
"""

import os
import sys
import unittest
from unittest import mock

import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import tools.market_data as market_data  # noqa: E402

SAMPLE = {
    "name": "Ethereum",
    "symbol": "eth",
    "market_data": {
        "current_price": {"usd": 2500.0},
        "market_cap": {"usd": 300_000_000_000},
        "total_volume": {"usd": 10_000_000_000},
        "price_change_percentage_24h": 1.5,
        "price_change_percentage_7d": 3.0,
        "ath_change_percentage": {"usd": -50.0},
    },
}


def _resp(status, headers=None, payload=None):
    """Build a stand-in requests.Response with just the surface we touch."""
    r = mock.Mock()
    r.status_code = status
    r.headers = headers or {}
    r.json.return_value = payload if payload is not None else {}
    if 400 <= status < 600:
        r.raise_for_status.side_effect = requests.HTTPError(f"HTTP {status}")
    else:
        r.raise_for_status.return_value = None
    return r


class FetchRetryTests(unittest.TestCase):
    def test_429_then_success_retries_and_returns_payload(self):
        responses = [_resp(429, {"Retry-After": "1"}), _resp(200, payload=SAMPLE)]
        with mock.patch.object(market_data._SESSION, "get", side_effect=responses) as get, \
                mock.patch.object(market_data.time, "sleep") as sleep:
            data = market_data.fetch_token_data("ethereum")

        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(1.0)
        self.assertEqual(data["name"], "Ethereum")
        self.assertEqual(data["symbol"], "ETH")  # uppercased by the parser
        self.assertEqual(data["volume_to_market_cap_ratio"], round(10_000_000_000 / 300_000_000_000, 4))

    def test_exhausted_retries_raise_rate_limited(self):
        responses = [_resp(429) for _ in range(market_data.MAX_ATTEMPTS)]
        with mock.patch.object(market_data._SESSION, "get", side_effect=responses) as get, \
                mock.patch.object(market_data.time, "sleep"):
            with self.assertRaises(market_data.RateLimited):
                market_data.fetch_token_data("ethereum")

        self.assertEqual(get.call_count, market_data.MAX_ATTEMPTS)

    def test_5xx_is_retried_like_a_rate_limit(self):
        responses = [_resp(503), _resp(200, payload=SAMPLE)]
        with mock.patch.object(market_data._SESSION, "get", side_effect=responses) as get, \
                mock.patch.object(market_data.time, "sleep") as sleep:
            market_data.fetch_token_data("ethereum")

        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once()

    def test_404_is_not_retried(self):
        with mock.patch.object(market_data._SESSION, "get", side_effect=[_resp(404)]) as get, \
                mock.patch.object(market_data.time, "sleep") as sleep:
            with self.assertRaises(market_data.TokenNotFound):
                market_data.fetch_token_data("ethereum")

        self.assertEqual(get.call_count, 1, "a 404 is permanent - must not waste a retry")
        sleep.assert_not_called()

    def test_retry_after_is_capped(self):
        # A hostile or buggy Retry-After must not hang the demo.
        responses = [_resp(429, {"Retry-After": "9999"}), _resp(200, payload=SAMPLE)]
        with mock.patch.object(market_data._SESSION, "get", side_effect=responses), \
                mock.patch.object(market_data.time, "sleep") as sleep:
            market_data.fetch_token_data("ethereum")

        sleep.assert_called_once_with(market_data.MAX_RETRY_AFTER)

    def test_non_numeric_retry_after_falls_back_to_backoff(self):
        responses = [_resp(429, {"Retry-After": "soon"}), _resp(200, payload=SAMPLE)]
        with mock.patch.object(market_data._SESSION, "get", side_effect=responses), \
                mock.patch.object(market_data.time, "sleep") as sleep:
            market_data.fetch_token_data("ethereum")

        sleep.assert_called_once_with(market_data.BACKOFF_SECONDS * 1)

    def test_non_dict_market_data_does_not_crash(self):
        # CoinGecko omitting "market_data" shouldn't blow up with a KeyError.
        with mock.patch.object(market_data._SESSION, "get", side_effect=[_resp(200, payload={"name": "X"})]):
            data = market_data.fetch_token_data("x")

        self.assertIsNone(data["price_usd"])
        self.assertIsNone(data["volume_to_market_cap_ratio"])


class InputValidationTests(unittest.TestCase):
    def test_path_like_id_rejected_without_a_request(self):
        with mock.patch.object(market_data._SESSION, "get") as get:
            with self.assertRaises(market_data.TokenNotFound):
                market_data.fetch_token_data("../../search")
        self.assertFalse(get.called, "must reject before issuing any request")

    def test_empty_id_rejected(self):
        with self.assertRaises(market_data.TokenNotFound):
            market_data.fetch_token_data("")


class SearchTests(unittest.TestCase):
    def _search(self, coins):
        with mock.patch.object(market_data._SESSION, "get", side_effect=[_resp(200, payload={"coins": coins})]):
            return market_data.search_coin_id("pepe")

    def test_prefers_lowest_market_cap_rank(self):
        # The whole point: text relevance put the impersonator first.
        result = self._search([
            {"id": "pepe-impersonator", "market_cap_rank": None},
            {"id": "pepe", "market_cap_rank": 25},
            {"id": "pepe-2-0", "market_cap_rank": 400},
        ])
        self.assertEqual(result, "pepe")

    def test_falls_back_to_first_when_nothing_ranked(self):
        result = self._search([
            {"id": "first", "market_cap_rank": None},
            {"id": "second", "market_cap_rank": None},
        ])
        self.assertEqual(result, "first")

    def test_returns_none_on_no_matches(self):
        self.assertIsNone(self._search([]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
