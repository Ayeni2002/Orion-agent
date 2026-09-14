# orion-agent

A CLI DeFi scoring agent. Give it a token, it pulls live market data from
CoinGecko, asks an LLM for a structured risk/opportunity assessment, and prints
a report.

```
CoinGecko (no key)  →  raw market data  →  LLM JSON  →  score + verdict
```

## Setup

```bash
cd orion-agent
python -m venv .venv && .venv\Scripts\activate   # Windows
# source .venv/bin/activate                      # macOS / Linux
pip install -r requirements.txt
copy .env.example .env                           # then fill in the LLM_* values
```

The provider is configuration, not code. Fill these in:

| Variable | What goes in it |
|---|---|
| `LLM_ENDPOINT` | The chat endpoint URL |
| `LLM_API_STYLE` | `anthropic` or `openai` — see below |
| `LLM_MODEL` | The exact model id from your provider's dashboard |
| `LLM_API_KEY` | Your key for that provider |

`LLM_MODEL` has no default on purpose: an unset model stops at startup with a
readable message instead of failing at the API with a confusing one.

The two styles are genuinely different wire formats, not synonyms:

| | `anthropic` | `openai` |
|---|---|---|
| Auth | `x-api-key` | `Authorization: Bearer` |
| System prompt | top-level `system` field | first entry in `messages` |
| JSON mode | none — enforced by the prompt | `response_format: json_object` |
| Reply is at | `content[0].text` | `choices[0].message.content` |

Pick `anthropic` for a relay whose docs mention `ANTHROPIC_BASE_URL` or
`/v1/messages`, and `openai` for one that mentions `/v1/chat/completions`. The
reply is parsed defensively either way, so a model that wraps its JSON in a
```json fence still works.

## Run

```bash
python src/agent.py ethereum
python src/agent.py solana
python src/agent.py "pepe"                        # not a valid id — name-search fallback

python src/agent.py --warm ethereum solana pepe   # cache these now, for later
python src/agent.py ethereum --offline            # replay the cached run
```

Every run is appended to `demo/sample_run.md` and cached to `demo/cache/`.

## Offline mode

Two things need the network: CoinGecko for the data, the LLM for the scoring. A
cached run holds **both**, so `--offline` replays a complete result with no
network at all. If a live run fails partway — either hop — the agent drops to the
cached run automatically.

```bash
python src/agent.py --warm ethereum solana pepe   # once, while you have wifi
python src/agent.py ethereum --offline            # on stage, wifi or not
```

`demo/cache/` is committed on purpose, so a fresh clone on the demo laptop works
offline with no preparation.

**The cached banner is deliberate.** Cached output is not live data, and printing
that plainly beats being caught out when a judge asks whether it was live.

## Layout

| Path | What it is |
|---|---|
| `src/agent.py` | CLI entry point — fetch, score, print |
| `src/tools/market_data.py` | CoinGecko client (retries, rate-limit handling) |
| `src/llm.py` | LLM client — either dialect, chosen by `.env` |
| `src/tools/cache.py` | Offline cache of complete runs |
| `src/prompts/system_prompt.md` | Scoring rubric. Edit this to change the agent's behaviour |
| `demo/cache/` | Cached runs — committed, so a fresh clone works offline |
| `demo/sample_run.md` | Auto-appended run log (gitignored) |

## Demo-day notes

- **CoinGecko's free tier rate-limits hard**, and a room full of hackers on one
  wifi makes it worse. The client retries with backoff, then fails with a clear
  message rather than a traceback. If it does fail, show a saved entry from
  `demo/sample_run.md`.
- **Name search prefers the highest-market-cap match**, not the first text hit —
  searching a ticker can otherwise land on an impersonator, which matters a lot
  in a tool whose whole job is risk scoring.
- The prompt is the most interesting knob. It asks for a 0-100 score, a verdict, a
  confidence level, key signals, risk flags, and a plain-English summary. Scores
  are banded (see the table in `src/prompts/system_prompt.md`) so the range gets
  used instead of everything clustering near 50. `score_check.py` exists to tell
  you whether that is actually working.
- **Console output is deliberately ASCII-only — keep it that way.** The Windows
  console codepage can't always encode em dashes or curly quotes, and printing an
  unencodable character raises `UnicodeEncodeError` mid-report. The model's own
  `summary` text is likewise guarded with `errors="replace"` in `main()`, since
  we don't control what it returns.

## Not done yet

- Test suites, all runnable with no API key:
  - `python test_llm.py` — request shaping for both dialects, reply parsing,
    and HTTP error mapping. No network.
  - `python test_cache.py` — the offline cache and the live→cached fallback.
    No network.
  - `python test_market_data.py` — mocked failure handling: rate limits, 5xx,
    404s, backoff caps, search ranking. No network.
  - `python smoke_test.py` — live checks against CoinGecko (4 requests).
  A `SKIP` line in the smoke test means CoinGecko rate-limited you and that
  check did not run, so a run with skips is not a clean bill.
- Data comes from CoinGecko only — no on-chain signals (Etherscan, DEX pools,
  holder distribution). That's the obvious next depth increase.
