"""
On-disk cache of complete agent runs, so a demo survives venue wifi.

An entry holds the market data *and* the model's assessment, not just the data.
That matters: DeepSeek is a network call too, so caching only CoinGecko's half
would still leave an offline run dead at the scoring step.

    demo/cache/<coin_id>.json

These files are meant to be committed. A fresh clone on the demo laptop should
be able to run `--offline` with no preparation at all.
"""

import json
import os
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))  # src/tools
_ROOT = os.path.dirname(os.path.dirname(_HERE))  # repo root
CACHE_DIR = os.path.join(_ROOT, "demo", "cache")


def _is_safe_slug(value: str) -> bool:
    """Guard the filename we build. Mirrors market_data's rule for the same shape
    of input, but duplicated deliberately — this one exists to keep a query from
    escaping CACHE_DIR, which is a storage concern, not a URL one."""
    return bool(value) and all(c.isalnum() or c in "-_" for c in value)


def _entry_path(coin_id: str) -> str:
    return os.path.join(CACHE_DIR, f"{coin_id}.json")


def save(coin_id: str, queried: str, token_data: dict, assessment: dict) -> dict | None:
    """Write a completed run. Returns the entry, or None if the id isn't storable."""
    if not _is_safe_slug(coin_id):
        return None

    aliases = {coin_id, str(queried).strip().lower()}

    # Keep aliases from any earlier run so "pepe" and "pepe-pepe" both resolve here.
    previous = load(coin_id)
    if previous:
        aliases |= set(previous.get("aliases") or [])

    entry = {
        "coin_id": coin_id,
        "aliases": sorted(a for a in aliases if a),
        "cached_at_utc": datetime.now(timezone.utc).isoformat(),
        "token_data": token_data,
        "assessment": assessment,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(_entry_path(coin_id), "w", encoding="utf-8") as f:
        json.dump(entry, f, indent=2, default=str)
    return entry


def load(coin_id: str) -> dict | None:
    """Read one entry by exact coin id. Returns None if absent or unreadable."""
    if not _is_safe_slug(coin_id):
        return None
    path = _entry_path(coin_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def find(query: str) -> dict | None:
    """Look up a cached run by coin id, or by any alias it was queried under.

    The alias pass is what makes `--offline pepe` work: resolving a name to an id
    needs the network, so offline we can only match against what we recorded.
    """
    entry = load(query)
    if entry:
        return entry

    normalized = (query or "").strip().lower()
    if not normalized or not os.path.isdir(CACHE_DIR):
        return None

    for name in sorted(os.listdir(CACHE_DIR)):
        if not name.endswith(".json"):
            continue
        entry = load(name[: -len(".json")])
        if entry and normalized in (entry.get("aliases") or []):
            return entry
    return None


def age(entry: dict) -> str:
    """Human-readable age, e.g. '2h 14m ago'. Never raises."""
    stamp = (entry or {}).get("cached_at_utc")
    if not stamp:
        return "unknown age"
    try:
        when = datetime.fromisoformat(stamp)
    except (TypeError, ValueError):
        return "unknown age"
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)

    minutes = int((datetime.now(timezone.utc) - when).total_seconds() // 60)
    if minutes < 1:
        return "less than a minute ago"
    if minutes < 60:
        return f"{minutes}m ago"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes}m ago"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h ago"


def cached_ids() -> list[str]:
    """Coin ids currently available offline, for help text and messages."""
    if not os.path.isdir(CACHE_DIR):
        return []
    return sorted(n[: -len(".json")] for n in os.listdir(CACHE_DIR) if n.endswith(".json"))
