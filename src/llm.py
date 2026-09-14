"""
LLM provider client.

The agent originally called DeepSeek directly with its endpoint baked in. This
module makes the provider a configuration choice instead, because we have already
had to switch once and hardcoding a second provider would just repeat the problem.

Configure in .env:

    LLM_ENDPOINT=https://api.deepseek.com/anthropic/v1/messages
    LLM_API_STYLE=anthropic
    LLM_MODEL=deepseek-v4-flash
    LLM_API_KEY=<your key>

LLM_API_STYLE picks the wire format:

  anthropic  Anthropic Messages API. Auth via x-api-key, the system prompt is a
             top-level field, and the reply is content[0].text. There is no
             response_format, so the model is asked for JSON by the prompt and
             the reply is parsed defensively.

  openai     OpenAI chat completions. Auth via Bearer, the system prompt is the
             first message, and we can request response_format json_object.
"""

import json
import os

import requests

DEFAULT_STYLE = "anthropic"
# Providers expose an Anthropic-compatible API as BASE_URL + "/v1/messages"
# (the official SDK appends that suffix itself). This client posts to
# LLM_ENDPOINT verbatim, so the full path belongs here, not just the base.
DEFAULT_ENDPOINT = "https://api.deepseek.com/anthropic/v1/messages"
PLACEHOLDER_KEY = "sk-your-key-here"
MAX_TOKENS = 1500
TIMEOUT_SECONDS = 60
ANTHROPIC_VERSION = "2023-06-01"


class LLMError(RuntimeError):
    """The model could not be reached, was misconfigured, or returned nonsense."""


def _resolved_config() -> tuple[str, str, str, str]:
    """Read and validate provider settings. Raises LLMError with a usable message."""
    style = (os.environ.get("LLM_API_STYLE") or DEFAULT_STYLE).strip().lower()
    endpoint = (os.environ.get("LLM_ENDPOINT") or DEFAULT_ENDPOINT).strip()
    model = (os.environ.get("LLM_MODEL") or "").strip()
    key = (
        os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
    ).strip()

    if style not in ("anthropic", "openai"):
        raise LLMError(
            f"LLM_API_STYLE is {style!r}; expected 'anthropic' or 'openai'."
        )
    if not key:
        raise LLMError(
            "No API key set. Add LLM_API_KEY=<your key> to .env, or export it."
        )
    if key == PLACEHOLDER_KEY:
        raise LLMError(
            "LLM_API_KEY still holds the placeholder from .env.example. Open .env "
            "and replace it with your real key."
        )
    if not model:
        raise LLMError(
            "LLM_MODEL is not set. Put the exact model id from your provider's "
            "dashboard into .env."
        )
    return style, endpoint, model, key


def build_request(style, endpoint, model, key, system_prompt, token_data):
    """Return (headers, body) for the given dialect.

    Split out from the network call so both dialects can be verified without
    sending anything.
    """
    user_content = json.dumps(token_data)

    if style == "anthropic":
        headers = {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        body = {
            "model": model,
            "max_tokens": MAX_TOKENS,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_content}],
        }
    elif style == "openai":
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.3,
        }
    else:
        raise LLMError(f"Unknown LLM_API_STYLE {style!r}.")

    return headers, body, endpoint


def extract_text(style, payload):
    """Pull the assistant's text out of a provider response."""
    if style == "anthropic":
        content = payload.get("content")
        if isinstance(content, str):
            return content
        blocks = content or []
        # Some relays add non-text blocks (thinking, tool_use); take only text.
        return "".join(
            b.get("text", "")
            for b in blocks
            if isinstance(b, dict) and b.get("text")
        )

    choices = payload.get("choices") or []
    if not choices:
        return ""
    return (choices[0].get("message") or {}).get("content") or ""


def _strip_code_fences(text):
    """Remove a ```json ... ``` wrapper, plus anything after the closing fence.

    Needed because the Anthropic Messages API has no response_format, so a model
    told to "respond in exactly this JSON" may still fence it, and may still add
    a sentence of commentary underneath.
    """
    if not text.startswith("```"):
        return text

    body = []
    for line in text.splitlines()[1:]:  # drop the ```json opener
        if line.strip().startswith("```"):
            break
        body.append(line)
    return "\n".join(body).strip()


def parse_assessment(text):
    """Parse the model's reply into a dict, tolerating fences and stray prose."""
    if not text or not text.strip():
        raise LLMError("Model returned an empty reply.")

    cleaned = _strip_code_fences(text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Last resort: the outermost {...} in whatever came back.
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            pass

    raise LLMError(f"Model did not return valid JSON: {text[:200]!r}")


def _raise_for_status(resp):
    """Turn an HTTP failure into a message that says what to actually do."""
    if resp.status_code < 400:
        return

    hint = {
        401: "the key was rejected. Check LLM_API_KEY, that it is active, and that "
             "the account has credit.",
        402: "the account has no credit balance.",
        403: "the key has no access to this model.",
        404: "endpoint or model name is wrong. Check LLM_ENDPOINT and LLM_MODEL.",
        429: "rate limited. Wait a moment and retry.",
    }.get(resp.status_code)

    message = f"{resp.status_code} from {resp.url}"
    if hint:
        message += f": {hint}"
    detail = (getattr(resp, "text", "") or "").strip()[:200]
    if detail:
        message += f" (response: {detail})"
    raise LLMError(message)


def assess(system_prompt: str, token_data: dict) -> dict:
    """Ask the configured model to score one token. Returns the parsed assessment."""
    style, endpoint, model, key = _resolved_config()
    headers, body, url = build_request(
        style, endpoint, model, key, system_prompt, token_data
    )

    try:
        resp = requests.post(url, headers=headers, json=body, timeout=TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise LLMError(f"Could not reach {url}: {exc}") from exc

    _raise_for_status(resp)

    try:
        payload = resp.json()
    except ValueError as exc:
        raise LLMError(
            f"{url} returned non-JSON: {(resp.text or '')[:200]!r}"
        ) from exc

    return parse_assessment(extract_text(style, payload))
