"""
Fetches real token market data from CoinGecko's free public API (no key required).
This is the "real data" input for the scoring agent — swap this out later for
on-chain data (Etherscan, DEX pools, etc.) if you want to go deeper.
"""

import time

import requests

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

# The free tier rate-limits aggressively, and shared conference wifi makes it
# worse. Retry transient failures a couple of times before giving up.
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 2.0
MAX_RETRY_AFTER = 30.0

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "orion-agent/1.0 (hackathon demo)"})


class TokenNotFound(Exception):
    """CoinGecko has no token with that id (HTTP 404)."""


class RateLimited(Exception):
    """CoinGecko kept rate-limiting (429/5xx) after every retry."""


def _retry_delay(resp: requests.Response, attempt: int) -> float:
    """Honour the server's Retry-After, but never sleep longer than MAX_RETRY_AFTER."""
    retry_after = resp.headers.get("Retry-After", "")
    if retry_after.isdigit():
        return min(float(retry_after), MAX_RETRY_AFTER)
    return BACKOFF_SECONDS * attempt


def _get(path: str, params: dict | None = None) -> dict:
    """GET a CoinGecko endpoint, retrying transient rate limits."""
    url = f"{COINGECKO_BASE}{path}"
    last_status = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        resp = _SESSION.get(url, params=params, timeout=15)

        if resp.status_code == 404:
            raise TokenNotFound(path)

        if resp.status_code == 429 or resp.status_code >= 500:
            last_status = resp.status_code
            if attempt == MAX_ATTEMPTS:
                break
            time.sleep(_retry_delay(resp, attempt))
            continue

        resp.raise_for_status()
        return resp.json()

    raise RateLimited(
        f"CoinGecko returned {last_status} after {MAX_ATTEMPTS} attempts. Wait a "
        "minute, or fall back to a saved run from demo/ during the demo."
    )


def fetch_token_data(coin_id: str) -> dict:
    """
    coin_id: CoinGecko's slug for the token, e.g. 'ethereum', 'solana', 'chainlink'.
    Find IDs at https://www.coingecko.com/en/api/documentation or via /search.
    """
    coin_id = (coin_id or "").strip().lower()
    # Reject anything that isn't a plain slug so it can't rewrite the request path.
    # Callers treat this the same as "unknown id" and fall back to a name search.
    if not coin_id or not all(c.isalnum() or c in "-_" for c in coin_id):
        raise TokenNotFound(coin_id)

    data = _get(
        f"/coins/{coin_id}",
        params={
            "localization": "false",
            "tickers": "false",
            "market_data": "true",
            "community_data": "false",
            "developer_data": "false",
        },
    )

    md = data.get("market_data") or {}
    price = md.get("current_price") or {}
    market_cap = md.get("market_cap") or {}
    volume = md.get("total_volume") or {}
    ath_change = md.get("ath_change_percentage") or {}

    market_cap_usd = market_cap.get("usd")
    volume_24h_usd = volume.get("usd")

    return {
        "name": data.get("name"),
        "symbol": (data.get("symbol") or "").upper(),
        "price_usd": price.get("usd"),
        "market_cap_usd": market_cap_usd,
        "volume_24h_usd": volume_24h_usd,
        # Precomputed so the model isn't left guessing at the "liquidity signals"
        # the system prompt asks it to reason about.
        "volume_to_market_cap_ratio": (
            round(volume_24h_usd / market_cap_usd, 4)
            if volume_24h_usd and market_cap_usd
            else None
        ),
        "price_change_24h_pct": md.get("price_change_percentage_24h"),
        "price_change_7d_pct": md.get("price_change_percentage_7d"),
        "ath_change_pct": ath_change.get("usd"),
    }


def search_coin_id(query: str) -> str | None:
    """Helper: look up a CoinGecko coin_id from a name/symbol the user typed.

    CoinGecko ranks /search by text relevance, not legitimacy, so the first hit
    for a symbol like "pepe" is often an impersonator. Prefer the candidate with
    the best (numerically lowest) market-cap rank instead.
    """
    data = _get("/search", params={"query": query})
    coins = data.get("coins") or []
    if not coins:
        return None

    ranked = [c for c in coins if isinstance(c.get("market_cap_rank"), int)]
    if not ranked:
        # Nothing has a rank — better to return the likeliest hit than nothing.
        return coins[0].get("id")

    return min(ranked, key=lambda c: c["market_cap_rank"])["id"]
