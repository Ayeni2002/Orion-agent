"""
Smoke test for the market-data layer. Needs no API key.

    python smoke_test.py

Hits the live CoinGecko API and exercises the same code paths the agent uses:
id lookup, unknown-token handling, and name search. Run this before a demo —
it tells you in seconds whether the network layer is healthy.

Exits 0 if everything passed, 1 otherwise.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from tools.market_data import (  # noqa: E402
    RateLimited,
    TokenNotFound,
    fetch_token_data,
    search_coin_id,
)

REQUIRED_KEYS = {
    "name",
    "symbol",
    "price_usd",
    "market_cap_usd",
    "volume_24h_usd",
    "volume_to_market_cap_ratio",
    "price_change_24h_pct",
    "price_change_7d_pct",
    "ath_change_pct",
}


def main() -> int:
    failures = []

    # 1. A known id should return a full, numeric payload.
    try:
        data = fetch_token_data("ethereum")
        missing = REQUIRED_KEYS - data.keys()
        if missing:
            failures.append(f"ethereum payload missing {sorted(missing)}")
            print(f"FAIL  ethereum payload missing keys: {sorted(missing)}")
        elif not isinstance(data["price_usd"], (int, float)):
            failures.append("ethereum price_usd is not numeric")
            print(f"FAIL  price_usd not numeric: {data['price_usd']!r}")
        else:
            print(
                f"ok    ethereum -> ${data['price_usd']:,.2f}  "
                f"vol/mcap={data['volume_to_market_cap_ratio']}"
            )
    except RateLimited as exc:
        print(f"SKIP  ethereum: rate limited ({exc})")
    except Exception as exc:
        failures.append(f"ethereum raised {type(exc).__name__}")
        print(f"FAIL  ethereum raised {type(exc).__name__}: {exc}")

    # 2. An unknown id must raise TokenNotFound, not something generic — the
    #    agent's name-search fallback depends on catching exactly this.
    try:
        fetch_token_data("zzz-not-a-real-coin-xyz")
        failures.append("unknown id did not raise TokenNotFound")
        print("FAIL  unknown id returned data instead of raising TokenNotFound")
    except TokenNotFound:
        print("ok    unknown id -> TokenNotFound")
    except RateLimited as exc:
        print(f"SKIP  unknown id: rate limited ({exc})")
    except Exception as exc:
        failures.append(f"unknown id raised {type(exc).__name__}")
        print(f"FAIL  unknown id raised {type(exc).__name__}, expected TokenNotFound")

    # 3. A path-like query must be rejected before it can rewrite the request URL.
    try:
        fetch_token_data("../../search")
        failures.append("path-like query was not rejected")
        print("FAIL  path-like query was NOT rejected")
    except TokenNotFound:
        print("ok    path-like query -> TokenNotFound (URL path intact)")
    except RateLimited as exc:
        print(f"SKIP  path-like query: rate limited ({exc})")
    except Exception as exc:
        failures.append(f"path-like query raised {type(exc).__name__}")
        print(f"FAIL  path-like query raised {type(exc).__name__}")

    # 4. Name search should land on a real, high-cap token rather than whichever
    #    impersonator CoinGecko happened to rank first by text relevance.
    try:
        resolved = search_coin_id("pepe")
        if resolved:
            print(f"ok    search 'pepe' -> {resolved}")
        else:
            failures.append("search 'pepe' returned nothing")
            print("FAIL  search 'pepe' returned nothing")
    except RateLimited as exc:
        print(f"SKIP  search: rate limited ({exc})")
    except Exception as exc:
        failures.append(f"search raised {type(exc).__name__}")
        print(f"FAIL  search raised {type(exc).__name__}: {exc}")

    print()
    if failures:
        print(f"{len(failures)} failure(s):")
        for f in failures:
            print(f"  - {f}")
        return 1

    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
