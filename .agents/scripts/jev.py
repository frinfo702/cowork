#!/usr/bin/env python3
"""TypeSafe Jev client for cowork runtime decisions.

Jev turns a state plus typed questions into typed answers, in parallel,
in 70-500ms. Every cowork decision that is a classification, routing,
gate, or scoring call goes through here.

Usage:
  printf '%s' '{"state": "...", "questions": {...}}' | python3 jev.py
  python3 jev.py --request '{"state": "...", "questions": {...}}'
  python3 jev.py --check
  python3 jev.py --selftest
  python3 jev.py --livetest

Env:
  TYPESAFE_API_KEY  required for live calls; absent means unavailable
  JEV_MODEL         model id (default jev-latest)
  JEV_TIMEOUT       seconds per request (default 6)
  JEV_API_URL       override endpoint (default https://api.typesafe.ai/v1/systemone)
  JEV_CACHE_TTL     cache seconds (default 86400; 0 disables the cache)
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-latest"
DEFAULT_TIMEOUT = 6.0
DEFAULT_RETRIES = 2
DEFAULT_CACHE_TTL = 86400

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<!\d)0\d{1,4}[-( ]?\d{1,4}[- )]?\d{3,4}(?!\d)")
NUMBER_RE = re.compile(r"(?<![\w.])\d[\d,]{6,}(?![\w.])")
URL_RE = re.compile(r"https?://\S+")
ID_RE = re.compile(r"(?<![A-Za-z0-9])[A-Za-z0-9_-]{16,}(?![A-Za-z0-9])")

QUESTION_TYPES = ("noul", "choice", "score")


class JevError(RuntimeError):
    pass


def scrub(value):
    if isinstance(value, dict):
        return {key: scrub(item) for key, item in value.items()}
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if not isinstance(value, str):
        return value
    text = EMAIL_RE.sub("[EMAIL]", value)
    text = PHONE_RE.sub("[PHONE]", text)
    text = NUMBER_RE.sub("[NUMBER]", text)
    text = URL_RE.sub(lambda m: m.group(0).split("?", 1)[0].split("#", 1)[0], text)
    text = ID_RE.sub("[ID]", text)
    return text


def repo_root():
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def cache_dir():
    return os.path.join(repo_root(), ".agents", ".cache", "jev")


def validate_answers(questions, answers):
    if not isinstance(answers, dict):
        raise JevError("answers is not an object")
    for name, question in questions.items():
        answer = answers.get(name)
        if not isinstance(answer, dict):
            raise JevError("missing answer: %s" % name)
        kind = question.get("type")
        if answer.get("type") != kind:
            raise JevError("answer type mismatch for %s" % name)
        if kind == "noul":
            value = answer.get("noul")
            if not isinstance(value, (int, float)) or not 0.0 <= float(value) <= 1.0:
                raise JevError("bad noul for %s" % name)
        elif kind == "choice":
            choice = answer.get("choice")
            options = question.get("criteria", {})
            if choice not in options:
                raise JevError("choice %r outside criteria for %s" % (choice, name))
            if not isinstance(answer.get("probabilities"), dict):
                raise JevError("missing probabilities for %s" % name)
        elif kind == "score":
            if not isinstance(answer.get("score"), (int, float)):
                raise JevError("bad score for %s" % name)
            if not isinstance(answer.get("legend"), dict):
                raise JevError("missing legend for %s" % name)
        else:
            raise JevError("unknown question type %r" % kind)
    return answers


class Jev:
    def __init__(self, api_key=None, model=None, timeout=None, retries=DEFAULT_RETRIES,
                 cache_ttl=None, transport=None, cache=True):
        self.api_key = api_key if api_key is not None else os.environ.get("TYPESAFE_API_KEY", "")
        self.model = model or os.environ.get("JEV_MODEL", DEFAULT_MODEL)
        self.timeout = float(timeout if timeout is not None else os.environ.get("JEV_TIMEOUT", DEFAULT_TIMEOUT))
        self.retries = retries
        self.transport = transport
        if cache_ttl is None:
            cache_ttl = float(os.environ.get("JEV_CACHE_TTL", DEFAULT_CACHE_TTL))
        self.cache_ttl = cache_ttl
        self.cache = cache and cache_ttl > 0
        self.api_url = os.environ.get("JEV_API_URL", API_URL)

    @property
    def available(self):
        return bool(self.api_key)

    def evaluate(self, state, questions, model=None, scrub_state=False, use_cache=True, record=True):
        payload = {
            "state": scrub(state) if scrub_state else state,
            "model": model or self.model,
            "questions": questions,
        }
        digest = hashlib.sha256(
            (self.api_url + "\n" + json.dumps(payload, ensure_ascii=False, sort_keys=True)).encode("utf-8")
        ).hexdigest()
        if self.cache and use_cache:
            cached = self._read_cache(digest)
            if cached is not None:
                cached["cached"] = True
                cached["latency_ms"] = 0
                return cached
        started = time.time()
        raw = self._request(payload)
        latency_ms = int((time.time() - started) * 1000)
        answers = validate_answers(questions, raw.get("answers", {}))
        result = {
            "model": raw.get("model", payload["model"]),
            "answers": answers,
            "usage": raw.get("usage", {}),
            "cached": False,
            "latency_ms": latency_ms,
        }
        if self.cache:
            self._write_cache(digest, result)
        if record:
            self._record(digest, result, questions)
        return result

    def _request(self, payload):
        if self.transport is not None:
            return self.transport(payload, self.timeout)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.api_url,
            data=body,
            headers={
                "Authorization": "Bearer " + self.api_key,
                "Content-Type": "application/json",
                "User-Agent": "cowork-jev/1.0",
            },
            method="POST",
        )
        last = None
        for attempt in range(self.retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                last = error
                if error.code in (429, 529) or error.code >= 500:
                    time.sleep(0.5 * (2 ** attempt))
                    continue
                detail = error.read().decode("utf-8", "replace")[:300]
                raise JevError("HTTP %d: %s" % (error.code, detail))
            except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
                last = error
                time.sleep(0.5 * (2 ** attempt))
        raise JevError("request failed: %s" % last)

    def _cache_path(self, digest):
        return os.path.join(cache_dir(), digest + ".json")

    def _read_cache(self, digest):
        path = self._cache_path(digest)
        try:
            age = time.time() - os.path.getmtime(path)
            if age > self.cache_ttl:
                return None
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    def _write_cache(self, digest, result):
        try:
            os.makedirs(cache_dir(), exist_ok=True)
            tmp = self._cache_path(digest) + ".tmp"
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump(result, handle, ensure_ascii=False)
            os.replace(tmp, self._cache_path(digest))
        except OSError:
            pass

    def _record(self, digest, result, questions):
        try:
            os.makedirs(cache_dir(), exist_ok=True)
            entry = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "model": result.get("model"),
                "latency_ms": result.get("latency_ms"),
                "usage": result.get("usage", {}),
                "questions": sorted(questions.keys()),
                "digest": digest[:16],
            }
            with open(os.path.join(cache_dir(), "usage.jsonl"), "a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError:
            pass


def selftest():
    calls = []

    def fake_transport(payload, timeout):
        calls.append(payload)
        return {
            "model": "jev-test",
            "answers": {
                "is_urgent": {"type": "noul", "noul": 0.92},
                "route": {
                    "type": "choice",
                    "choice": "finance",
                    "probabilities": {"finance": 0.85, "legal": 0.15},
                    "confidence": 0.7,
                },
            },
            "usage": {"input_tokens": 10, "output_tokens": 1},
        }

    client = Jev(api_key="test", transport=fake_transport, cache=False)
    questions = {
        "is_urgent": {"type": "noul", "instructions": "urgent?"},
        "route": {"type": "choice", "instructions": "where?", "criteria": {"finance": None, "legal": None}},
    }
    result = client.evaluate("hello", questions)
    assert result["answers"]["route"]["choice"] == "finance", result
    assert result["latency_ms"] >= 0, result
    assert calls[0]["model"] == "jev-latest", calls
    assert calls[0]["state"] == "hello", calls

    masked = scrub("連絡先は taro@example.com、電話 090-1234-5678、口座 1234567890、URL https://x.example/a?token=abc")
    assert "[EMAIL]" in masked and "[PHONE]" in masked and "[NUMBER]" in masked, masked
    assert "token=abc" not in masked, masked
    assert scrub({"note": ["a@b.co"]})["note"][0] == "[EMAIL]", masked

    try:
        validate_answers(questions, {"is_urgent": {"type": "noul", "noul": 0.5}})
        raise AssertionError("validation should fail on missing answer")
    except JevError:
        pass
    try:
        validate_answers(
            {"route": questions["route"]},
            {"route": {"type": "choice", "choice": "sales", "probabilities": {}, "confidence": 0.9}},
        )
        raise AssertionError("validation should reject choice outside criteria")
    except JevError:
        pass

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        client = Jev(api_key="test", transport=fake_transport, cache_ttl=60)
        original = client._cache_path
        client._cache_path = lambda digest: os.path.join(tmp, digest + ".json")
        first = client.evaluate("cached state", questions)
        second = client.evaluate("cached state", questions)
        assert first["cached"] is False and second["cached"] is True, (first, second)
        assert len(calls) == 2, calls
        client._cache_path = original

    client = Jev(api_key="", transport=fake_transport)
    assert client.available is False, "empty key must be unavailable"

    try:
        Jev(api_key="test", transport=lambda payload, timeout: (_ for _ in ()).throw(JevError("429"))).evaluate(
            "x", {"q": {"type": "noul", "instructions": "?"}}
        )
        raise AssertionError("transport error should propagate")
    except JevError:
        pass

    print("jev.py selftest: ok")


def livetest():
    client = Jev()
    if not client.available:
        print("jev.py livetest: skipped (TYPESAFE_API_KEY is not set)")
        return 2
    state = {
        "message": "I was charged twice for my subscription and need a refund today. I am extremely angry about this."
    }
    questions = {
        "is_urgent": {
            "type": "noul",
            "instructions": "Does this convey urgency?",
            "criteria": {"true": "time-sensitive", "false": "no urgency"},
        },
        "department": {
            "type": "choice",
            "instructions": "Which team should handle this?",
            "criteria": {"billing": "payments and refunds", "technical": "bugs and outages", "sales": "pricing"},
        },
        "frustration": {
            "type": "score",
            "instructions": "How frustrated is the customer?",
            "criteria": ["Calm", "Frustrated", "Very angry"],
        },
    }
    try:
        result = client.evaluate(state, questions, use_cache=False)
    except JevError as error:
        print("jev.py livetest: FAILED (%s)" % error)
        return 1
    answers = result["answers"]
    assert result["model"], result
    assert result["latency_ms"] >= 0, result
    assert result["usage"].get("input_tokens", 0) > 0, result
    assert answers["is_urgent"]["noul"] >= 0.6, answers
    assert answers["department"]["choice"] == "billing", answers
    assert 1.0 <= answers["frustration"]["score"] <= 2.0, answers
    print("jev.py livetest: ok model=%s latency=%dms usage=%s" % (
        result["model"], result["latency_ms"], result["usage"]))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", help="JSON request with state and questions")
    parser.add_argument("--request-file", help="path to a JSON request; - reads stdin")
    parser.add_argument("--model", help="model id override")
    parser.add_argument("--scrub", action="store_true", help="mask personal identifiers in state")
    parser.add_argument("--no-cache", action="store_true", help="bypass the response cache")
    parser.add_argument("--check", action="store_true", help="report availability and latency")
    parser.add_argument("--selftest", action="store_true", help="run the built-in self-check")
    parser.add_argument("--livetest", action="store_true", help="run a live API smoke test against TYPESAFE_API_KEY")
    args = parser.parse_args()

    if args.selftest:
        selftest()
        return 0

    if args.livetest:
        return livetest()

    client = Jev(model=args.model)

    if args.check:
        if not client.available:
            print(json.dumps({"available": False, "reason": "TYPESAFE_API_KEY is not set"}, ensure_ascii=False))
            return 1
        try:
            result = client.evaluate(
                "health check",
                {"ok": {"type": "noul", "instructions": "Is this a health check?", "criteria": {"true": "yes", "false": "no"}}},
                use_cache=False,
            )
            print(json.dumps(
                {"available": True, "model": result["model"], "latency_ms": result["latency_ms"], "usage": result["usage"]},
                ensure_ascii=False,
            ))
            return 0
        except JevError as error:
            print(json.dumps({"available": False, "reason": str(error)}, ensure_ascii=False))
            return 1

    if args.request_file:
        raw = sys.stdin.read() if args.request_file == "-" else open(args.request_file, encoding="utf-8").read()
    elif args.request:
        raw = args.request
    else:
        raw = sys.stdin.read()
    if not raw.strip():
        parser.error("no request provided")

    try:
        request = json.loads(raw)
    except ValueError as error:
        parser.error("invalid request JSON: %s" % error)
    state = request.get("state")
    questions = request.get("questions")
    if state is None or not isinstance(questions, dict) or not questions:
        parser.error("request needs state and questions")

    try:
        result = client.evaluate(state, questions, scrub_state=args.scrub, use_cache=not args.no_cache)
    except JevError as error:
        print(json.dumps({"error": str(error), "source": "unavailable"}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
