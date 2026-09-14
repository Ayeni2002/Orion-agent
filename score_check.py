"""
Calibration check for the scoring prompt.

    python score_check.py                      # a default spread of tokens
    python score_check.py bitcoin ethereum X   # or your own

A prompt can look sensible and still score everything in the 55-70 band, which
makes a demo of three tokens look like a demo of one. This runs a set of tokens
through the real agent and shows whether scores actually spread.

Needs the LLM_* settings in .env. Costs one CoinGecko request and one model call
per token. Successful runs are cached, so a later --offline demo benefits.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import agent  # noqa: E402

DEFAULT_TOKENS = ["bitcoin", "ethereum", "solana", "chainlink", "pepe"]

BANDS = [
    (80, 100, "Strong"),
    (60, 79, "Promising"),
    (40, 59, "Neutral"),
    (20, 39, "Caution"),
    (0, 19, "High Risk"),
]

NARROW_SPREAD = 25  # below this, the prompt is probably clustering


def band_for(score):
    if not isinstance(score, (int, float)):
        return None
    for low, high, name in BANDS:
        if low <= score <= high:
            return name
    return None


def main(argv):
    tokens = argv or DEFAULT_TOKENS
    rows = []

    for token in tokens:
        try:
            result = agent.run(token)
        except Exception as exc:
            print(f"  FAIL  {token}: {type(exc).__name__}: {exc}")
            rows.append((token, None, None, None, None, f"{type(exc).__name__}"))
            continue
        assessment = result.get("assessment") or {}
        rows.append((
            token,
            assessment.get("score"),
            assessment.get("verdict"),
            assessment.get("confidence"),
            result.get("source"),
            None,
        ))

    print()
    header = f"{'token':<14}{'score':>6}  {'verdict':<11}{'conf':<8}{'source':<7}band check"
    print(header)
    print("-" * len(header))

    mismatches = 0
    for token, score, verdict, confidence, source, err in rows:
        if err:
            print(f"{token:<14}{'--':>6}  {'ERROR':<11}{'':<8}{'':<7}{err}")
            continue
        expected = band_for(score)
        if expected == verdict:
            check = "ok"
        else:
            mismatches += 1
            check = f"CONTRADICTS (band says {expected})"
        print(f"{token:<14}{str(score):>6}  {str(verdict):<11}{str(confidence):<8}{str(source):<7}{check}")

    scores = sorted(r[1] for r in rows if isinstance(r[1], (int, float)))
    print()
    if scores:
        spread = scores[-1] - scores[0]
        print(f"scores: {scores}")
        print(f"min={scores[0]}  max={scores[-1]}  spread={spread}")
        if spread < NARROW_SPREAD:
            print(
                f"\nSPREAD IS NARROW (under {NARROW_SPREAD}). Scores are clustering, so the\n"
                "prompt is not discriminating. Sharpen the band anchors in\n"
                "src/prompts/system_prompt.md and run this again."
            )
    if mismatches:
        print(f"\n{mismatches} verdict(s) contradict their own score band.")

    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
