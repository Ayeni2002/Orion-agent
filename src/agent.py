"""
Orion-style DeFi scoring agent.

Usage:
    python src/agent.py ethereum
    python src/agent.py "pepe"          # will attempt a name search if not a valid id
    python src/agent.py ethereum --offline
    python src/agent.py --warm ethereum solana pepe

Provider settings live in .env at the repo root (copy .env.example to .env and
fill it in): LLM_ENDPOINT, LLM_API_STYLE, LLM_MODEL, LLM_API_KEY. See src/llm.py.

Every successful run is cached to demo/cache/, so a token that has been scored
once can be replayed with --offline when the network is gone.
"""

import os
import sys
import json
import datetime

import requests
from dotenv import load_dotenv

sys.path.append(os.path.dirname(__file__))
import llm  # noqa: E402
from tools import cache  # noqa: E402
from tools.market_data import (  # noqa: E402
    RateLimited,
    TokenNotFound,
    fetch_token_data,
    search_coin_id,
)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
PROMPT_PATH = os.path.join(HERE, "prompts", "system_prompt.md")
DEMO_DIR = os.path.join(REPO_ROOT, "demo")

# Pinned to the repo root so .env is found no matter which directory we're run from.
# override=True: load_dotenv defaults to override=False, which silently keeps any
# key already exported in the shell. A stale LLM_API_KEY in the environment then
# beats the file with no error, and the file looks broken when it is not.
load_dotenv(os.path.join(REPO_ROOT, ".env"), override=True)

USAGE = """Usage:
  python src/agent.py <coingecko_id_or_name>          live run, cached for later
  python src/agent.py <token> --offline               replay the cached run
  python src/agent.py --warm <token> [<token> ...]    fetch and cache now, quietly
"""


def load_system_prompt() -> str:
    with open(PROMPT_PATH, "r", encoding="utf-8") as f:
        return f.read()


def _from_cache(entry: dict, coin_query: str) -> dict:
    return {
        "queried": coin_query,
        "resolved_id": entry.get("coin_id"),
        "timestamp_utc": entry.get("cached_at_utc"),
        "source": "cache",
        "cache_age": cache.age(entry),
        "token_data": entry.get("token_data") or {},
        "assessment": entry.get("assessment") or {},
    }


def _no_cached_run(coin_query: str) -> RuntimeError:
    available = cache.cached_ids()
    if available:
        hint = f"Cached tokens: {', '.join(available)}."
    else:
        hint = (
            "Nothing is cached yet. Do a live run for each token you want "
            "available offline, then replay it with --offline."
        )
    return RuntimeError(f"No cached run for '{coin_query}'. {hint}")


def run(coin_query: str, offline: bool = False) -> dict:
    if offline:
        entry = cache.find(coin_query)
        if entry is None:
            raise _no_cached_run(coin_query)
        return _from_cache(entry, coin_query)

    try:
        coin_id = coin_query
        try:
            token_data = fetch_token_data(coin_id)
        except TokenNotFound:
            # Wasn't a valid coingecko id — try resolving it as a name/symbol.
            resolved = search_coin_id(coin_query)
            if not resolved:
                raise ValueError(f"Could not resolve '{coin_query}' to a known token.") from None
            coin_id = resolved
            token_data = fetch_token_data(coin_id)

        assessment = llm.assess(load_system_prompt(), token_data)

    except (RateLimited, TokenNotFound, ValueError, RuntimeError, requests.RequestException) as exc:
        # Any failure in either network hop — CoinGecko or DeepSeek — drops us to
        # the last recorded run for this token rather than dying on stage.
        entry = cache.find(coin_query)
        if entry is None:
            raise
        print(f"  ! Live run failed ({exc})", file=sys.stderr)
        print(f"  ! Falling back to the cached run from {cache.age(entry)}.", file=sys.stderr)
        return _from_cache(entry, coin_query)

    result = {
        "queried": coin_query,
        "resolved_id": coin_id,
        "timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": "live",
        "token_data": token_data,
        "assessment": assessment,
    }
    cache.save(coin_id, coin_query, token_data, assessment)
    return result


def print_report(result: dict) -> None:
    a = result.get("assessment") or {}
    td = result.get("token_data") or {}

    if result.get("source") == "cache":
        print(
            "\n" + "!" * 62 + "\n"
            f"  CACHED RESULT - recorded {result.get('cache_age', 'at an unknown time')}.\n"
            "  This is NOT live data. Say so if you are presenting it.\n"
            + "!" * 62
        )

    print(f"\n=== {td.get('name')} ({td.get('symbol')}) - Orion Agent Report ===")
    confidence = a.get("confidence")
    conf_str = f"  |  Confidence: {confidence}" if confidence else ""
    print(f"Score: {a.get('score')}/100  |  Verdict: {a.get('verdict')}{conf_str}")

    change = td.get("price_change_24h_pct")
    change_str = f"{change:.2f}%" if isinstance(change, (int, float)) else "n/a"
    print(f"Price: ${td.get('price_usd')}  24h: {change_str}")

    print("\nKey signals:")
    for s in a.get("key_signals") or []:
        print(f"  - {s}")
    print("\nRisk flags:")
    for r in a.get("risk_flags") or []:
        print(f"  - {r}")
    print(f"\nSummary: {a.get('summary')}\n")


def save_run_log(result: dict) -> None:
    """Append every run to demo/sample_run.md, anchored to the repo root so this
    works from any working directory."""
    os.makedirs(DEMO_DIR, exist_ok=True)
    with open(os.path.join(DEMO_DIR, "sample_run.md"), "a", encoding="utf-8") as f:
        f.write(f"\n---\n```json\n{json.dumps(result, indent=2, default=str)}\n```\n")


def warm(queries: list[str]) -> int:
    """Fetch and cache each token now, so they work offline later."""
    failures = []
    for query in queries:
        try:
            result = run(query)
        except Exception as exc:
            failures.append(query)
            print(f"  FAIL  {query} ({type(exc).__name__}): {exc}")
            continue

        name = (result.get("token_data") or {}).get("name")
        note = "" if result.get("source") == "live" else "  (fell back to existing cache)"
        print(f"  ok    {query} -> {name}{note}")

    print()
    if failures:
        print(f"Could not cache: {', '.join(failures)}")
        return 1
    print("Cached. These tokens now work with --offline.")
    return 0


def main(argv: list[str]) -> int:
    # The model's own `summary` text can contain characters the Windows console
    # codepage cannot encode. Without this, printing one raises UnicodeEncodeError
    # and kills the report on stage — a crash we do not control from source.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    flags = {a for a in argv if a.startswith("--")}
    positional = [a for a in argv if not a.startswith("--")]

    unknown = flags - {"--offline", "--warm"}
    if unknown:
        print(f"Unknown flag(s): {', '.join(sorted(unknown))}\n\n{USAGE}", file=sys.stderr)
        return 1

    if not positional:
        print(USAGE, file=sys.stderr)
        return 1

    if "--warm" in flags:
        return warm(positional)

    try:
        result = run(positional[0], offline="--offline" in flags)
    except (RateLimited, TokenNotFound, ValueError, RuntimeError, requests.RequestException) as exc:
        print(f"\n{positional[0]}: {exc}", file=sys.stderr)
        return 1

    print_report(result)
    save_run_log(result)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
