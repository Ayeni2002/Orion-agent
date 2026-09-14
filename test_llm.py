"""
Unit tests for the LLM provider client.

    python test_llm.py

No network, no API key. Every request is asserted on before it is "sent": the
shaping tests never call requests.post at all, and the end-to-end tests patch it.

The two dialects differ in ways that fail loudly at the API and quietly in a
diff, so each distinction gets its own test:

  anthropic  x-api-key, top-level "system", no response_format, content[0].text
  openai     Bearer, system as messages[0], response_format json_object
"""

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import llm  # noqa: E402

SYSTEM = "You are a scoring agent."
TOKEN = {"name": "Ethereum", "symbol": "ETH", "price_usd": 2500.0}
ASSESSMENT = {"score": 72, "verdict": "Promising"}

URL = "https://llm.test/v1/messages"


def env(**overrides):
    """A complete, valid provider config, with individual keys overridable to
    None to mean 'unset'."""
    base = {
        "LLM_ENDPOINT": URL,
        "LLM_API_STYLE": "anthropic",
        "LLM_MODEL": "claude-sonnet-5",
        "LLM_API_KEY": "sk-real-key",
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=None, url=URL):
        self.status_code = status_code
        self._payload = payload
        if text is not None:
            self.text = text
        elif payload is not None:
            self.text = json.dumps(payload)
        else:
            self.text = ""
        self.url = url

    def json(self):
        if self._payload is None:
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return self._payload


def anthropic_reply(text):
    return FakeResponse(payload={"content": [{"type": "text", "text": text}]})


def openai_reply(text):
    return FakeResponse(payload={"choices": [{"message": {"content": text}}]})


class ConfigTests(unittest.TestCase):
    def test_style_and_endpoint_default_when_absent(self):
        with mock.patch.dict(os.environ, env(LLM_API_STYLE=None, LLM_ENDPOINT=None), clear=True):
            style, endpoint, model, key = llm._resolved_config()

        self.assertEqual(style, llm.DEFAULT_STYLE)
        self.assertEqual(endpoint, llm.DEFAULT_ENDPOINT)
        self.assertEqual(model, "claude-sonnet-5")
        self.assertEqual(key, "sk-real-key")

    def test_missing_model_names_the_variable(self):
        with mock.patch.dict(os.environ, env(LLM_MODEL=None), clear=True):
            with self.assertRaises(llm.LLMError) as ctx:
                llm._resolved_config()

        self.assertIn("LLM_MODEL", str(ctx.exception))

    def test_missing_key_names_the_variable(self):
        with mock.patch.dict(os.environ, env(LLM_API_KEY=None), clear=True):
            with self.assertRaises(llm.LLMError) as ctx:
                llm._resolved_config()

        self.assertIn("LLM_API_KEY", str(ctx.exception))

    def test_placeholder_key_is_caught_before_the_api_sees_it(self):
        # Otherwise this surfaces as a bare 401 and looks like a bad key.
        with mock.patch.dict(os.environ, env(LLM_API_KEY=llm.PLACEHOLDER_KEY), clear=True):
            with self.assertRaises(llm.LLMError) as ctx:
                llm._resolved_config()

        self.assertIn("placeholder", str(ctx.exception))

    def test_unknown_style_names_the_variable(self):
        with mock.patch.dict(os.environ, env(LLM_API_STYLE="gemini"), clear=True):
            with self.assertRaises(llm.LLMError) as ctx:
                llm._resolved_config()

        self.assertIn("LLM_API_STYLE", str(ctx.exception))

    def test_style_is_normalized(self):
        with mock.patch.dict(os.environ, env(LLM_API_STYLE="  OpenAI  "), clear=True):
            style, _, _, _ = llm._resolved_config()

        self.assertEqual(style, "openai")

    def test_legacy_deepseek_key_still_works(self):
        # Someone who never migrated their .env should not be dead in the water.
        with mock.patch.dict(
            os.environ, {"LLM_MODEL": "m", "DEEPSEEK_API_KEY": "sk-legacy"}, clear=True
        ):
            _, _, _, key = llm._resolved_config()

        self.assertEqual(key, "sk-legacy")

    def test_llm_api_key_wins_over_the_legacy_name(self):
        with mock.patch.dict(
            os.environ,
            {"LLM_MODEL": "m", "LLM_API_KEY": "sk-new", "DEEPSEEK_API_KEY": "sk-legacy"},
            clear=True,
        ):
            _, _, _, key = llm._resolved_config()

        self.assertEqual(key, "sk-new")


class RequestShapingTests(unittest.TestCase):
    def test_anthropic_uses_x_api_key_and_no_bearer(self):
        headers, _, _ = llm.build_request(
            "anthropic", URL, "claude-sonnet-5", "sk-k", SYSTEM, TOKEN
        )

        self.assertEqual(headers["x-api-key"], "sk-k")
        self.assertEqual(headers["anthropic-version"], llm.ANTHROPIC_VERSION)
        self.assertNotIn("Authorization", headers)

    def test_anthropic_puts_the_system_prompt_at_the_top_level(self):
        _, body, _ = llm.build_request(
            "anthropic", URL, "claude-sonnet-5", "sk-k", SYSTEM, TOKEN
        )

        self.assertEqual(body["system"], SYSTEM)
        self.assertEqual([m["role"] for m in body["messages"]], ["user"])
        self.assertEqual(body["max_tokens"], llm.MAX_TOKENS)

    def test_anthropic_sends_no_response_format(self):
        # The Messages API rejects it. This is the mistake this module exists to
        # prevent, so it is asserted rather than assumed.
        _, body, _ = llm.build_request(
            "anthropic", URL, "claude-sonnet-5", "sk-k", SYSTEM, TOKEN
        )

        self.assertNotIn("response_format", body)

    def test_openai_uses_bearer_and_no_x_api_key(self):
        headers, _, _ = llm.build_request(
            "openai", URL, "gpt-4o", "sk-k", SYSTEM, TOKEN
        )

        self.assertEqual(headers["Authorization"], "Bearer sk-k")
        self.assertNotIn("x-api-key", headers)

    def test_openai_puts_the_system_prompt_first(self):
        _, body, _ = llm.build_request("openai", URL, "gpt-4o", "sk-k", SYSTEM, TOKEN)

        self.assertEqual([m["role"] for m in body["messages"]], ["system", "user"])
        self.assertEqual(body["messages"][0]["content"], SYSTEM)
        self.assertNotIn("system", {k: v for k, v in body.items() if k != "messages"})

    def test_openai_requests_json_mode(self):
        _, body, _ = llm.build_request("openai", URL, "gpt-4o", "sk-k", SYSTEM, TOKEN)

        self.assertEqual(body["response_format"], {"type": "json_object"})

    def test_token_data_is_serialized_as_the_user_turn(self):
        for style in ("anthropic", "openai"):
            with self.subTest(style=style):
                _, body, _ = llm.build_request(style, URL, "m", "sk-k", SYSTEM, TOKEN)
                user = [m for m in body["messages"] if m["role"] == "user"][0]
                self.assertEqual(json.loads(user["content"]), TOKEN)

    def test_endpoint_is_passed_through_untouched(self):
        custom = "https://relay.example.org/anthropic/v1/messages"
        _, _, url = llm.build_request("anthropic", custom, "m", "sk-k", SYSTEM, TOKEN)

        self.assertEqual(url, custom)

    def test_unknown_style_raises(self):
        with self.assertRaises(llm.LLMError):
            llm.build_request("gemini", URL, "m", "sk-k", SYSTEM, TOKEN)


class ExtractTextTests(unittest.TestCase):
    def test_anthropic_block_list(self):
        payload = {"content": [{"type": "text", "text": "hello"}]}
        self.assertEqual(llm.extract_text("anthropic", payload), "hello")

    def test_anthropic_plain_string_content(self):
        self.assertEqual(llm.extract_text("anthropic", {"content": "hello"}), "hello")

    def test_anthropic_skips_non_text_blocks(self):
        # Relays that expose thinking or tool_use blocks put them in the same list.
        payload = {
            "content": [
                {"type": "thinking", "thinking": "hmm"},
                {"type": "text", "text": "hello"},
            ]
        }
        self.assertEqual(llm.extract_text("anthropic", payload), "hello")

    def test_anthropic_joins_multiple_text_blocks(self):
        payload = {"content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}
        self.assertEqual(llm.extract_text("anthropic", payload), "ab")

    def test_anthropic_missing_content_is_empty_not_an_error(self):
        self.assertEqual(llm.extract_text("anthropic", {}), "")

    def test_openai_message_content(self):
        payload = {"choices": [{"message": {"content": "hello"}}]}
        self.assertEqual(llm.extract_text("openai", payload), "hello")

    def test_openai_no_choices_is_empty(self):
        self.assertEqual(llm.extract_text("openai", {"choices": []}), "")

    def test_openai_null_content_is_empty(self):
        payload = {"choices": [{"message": {"content": None}}]}
        self.assertEqual(llm.extract_text("openai", payload), "")


class ParseAssessmentTests(unittest.TestCase):
    def test_plain_json(self):
        self.assertEqual(llm.parse_assessment('{"score": 72}'), {"score": 72})

    def test_fenced_json(self):
        text = '```json\n{"score": 72}\n```'
        self.assertEqual(llm.parse_assessment(text), {"score": 72})

    def test_unlabelled_fence(self):
        text = '```\n{"score": 72}\n```'
        self.assertEqual(llm.parse_assessment(text), {"score": 72})

    def test_prose_around_the_json(self):
        text = 'Here is my assessment:\n{"score": 72}\nLet me know if you need more.'
        self.assertEqual(llm.parse_assessment(text), {"score": 72})

    def test_fenced_json_with_trailing_prose(self):
        text = '```json\n{"score": 72}\n```\n\nThat is my read.'
        self.assertEqual(llm.parse_assessment(text), {"score": 72})

    def test_empty_reply_raises(self):
        with self.assertRaises(llm.LLMError):
            llm.parse_assessment("")

    def test_whitespace_only_reply_raises(self):
        with self.assertRaises(llm.LLMError):
            llm.parse_assessment("   \n  ")

    def test_prose_with_no_json_raises(self):
        with self.assertRaises(llm.LLMError):
            llm.parse_assessment("I cannot score this token.")

    def test_unparseable_braces_raise(self):
        with self.assertRaises(llm.LLMError):
            llm.parse_assessment("{score: 72, trailing: }")

    def test_error_message_quotes_what_came_back(self):
        with self.assertRaises(llm.LLMError) as ctx:
            llm.parse_assessment("nonsense reply")

        self.assertIn("nonsense reply", str(ctx.exception))


class RaiseForStatusTests(unittest.TestCase):
    def test_success_is_a_no_op(self):
        llm._raise_for_status(FakeResponse(status_code=200, payload={}))

    def test_401_points_at_the_key(self):
        resp = FakeResponse(status_code=401, text='{"error":"invalid api key"}')
        with self.assertRaises(llm.LLMError) as ctx:
            llm._raise_for_status(resp)

        message = str(ctx.exception)
        self.assertIn("401", message)
        self.assertIn("LLM_API_KEY", message)
        self.assertIn("invalid api key", message, "the provider's own words matter")

    def test_402_points_at_credit(self):
        with self.assertRaises(llm.LLMError) as ctx:
            llm._raise_for_status(FakeResponse(status_code=402, text=""))

        self.assertIn("credit", str(ctx.exception))

    def test_403_points_at_model_access(self):
        with self.assertRaises(llm.LLMError) as ctx:
            llm._raise_for_status(FakeResponse(status_code=403, text=""))

        self.assertIn("access", str(ctx.exception))

    def test_404_points_at_the_endpoint_and_model(self):
        with self.assertRaises(llm.LLMError) as ctx:
            llm._raise_for_status(FakeResponse(status_code=404, text=""))

        message = str(ctx.exception)
        self.assertIn("LLM_ENDPOINT", message)
        self.assertIn("LLM_MODEL", message)

    def test_429_points_at_rate_limiting(self):
        with self.assertRaises(llm.LLMError) as ctx:
            llm._raise_for_status(FakeResponse(status_code=429, text=""))

        self.assertIn("rate limited", str(ctx.exception))

    def test_unmapped_status_still_raises_with_the_code(self):
        with self.assertRaises(llm.LLMError) as ctx:
            llm._raise_for_status(FakeResponse(status_code=500, text="boom"))

        self.assertIn("500", str(ctx.exception))
        self.assertIn("boom", str(ctx.exception))


class AssessTests(unittest.TestCase):
    def _assess(self, style, response, **env_overrides):
        with mock.patch.dict(os.environ, env(LLM_API_STYLE=style, **env_overrides), clear=True):
            with mock.patch.object(llm.requests, "post", return_value=response) as post:
                return llm.assess(SYSTEM, TOKEN), post

    def test_anthropic_end_to_end(self):
        result, post = self._assess("anthropic", anthropic_reply('{"score": 72}'))

        self.assertEqual(result, {"score": 72})
        self.assertEqual(post.call_args[0][0], URL)
        self.assertEqual(post.call_args[1]["headers"]["x-api-key"], "sk-real-key")

    def test_openai_end_to_end(self):
        result, post = self._assess("openai", openai_reply('{"score": 72}'))

        self.assertEqual(result, {"score": 72})
        self.assertEqual(post.call_args[1]["headers"]["Authorization"], "Bearer sk-real-key")

    def test_fenced_reply_is_still_parsed(self):
        # The likeliest real-world failure of the anthropic path, since we
        # cannot ask the API for JSON the way we can with response_format.
        result, _ = self._assess(
            "anthropic", anthropic_reply('```json\n{"score": 72}\n```')
        )

        self.assertEqual(result, {"score": 72})

    def test_timeout_is_wrapped_as_an_llm_error(self):
        import requests

        with mock.patch.dict(os.environ, env(), clear=True):
            with mock.patch.object(
                llm.requests, "post", side_effect=requests.Timeout("timed out")
            ):
                with self.assertRaises(llm.LLMError) as ctx:
                    llm.assess(SYSTEM, TOKEN)

        self.assertIn(URL, str(ctx.exception), "the message must say what we tried to reach")

    def test_non_json_body_is_wrapped_as_an_llm_error(self):
        # A proxy returning an HTML error page should not surface as a ValueError.
        response = FakeResponse(payload=None, text="<html>502 Bad Gateway</html>")
        with mock.patch.dict(os.environ, env(), clear=True):
            with mock.patch.object(llm.requests, "post", return_value=response):
                with self.assertRaises(llm.LLMError) as ctx:
                    llm.assess(SYSTEM, TOKEN)

        self.assertIn("502 Bad Gateway", str(ctx.exception))

    def test_empty_reply_is_wrapped_as_an_llm_error(self):
        with self.assertRaises(llm.LLMError):
            self._assess("anthropic", anthropic_reply(""))

    def test_misconfiguration_never_reaches_the_network(self):
        with mock.patch.dict(os.environ, env(LLM_MODEL=None), clear=True):
            with mock.patch.object(llm.requests, "post") as post:
                with self.assertRaises(llm.LLMError):
                    llm.assess(SYSTEM, TOKEN)

        post.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
