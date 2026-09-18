#!/usr/bin/env python3
"""Jev output guard for assistant drafts.

Checks a finished answer against the user's request and, when the answer is
over-long (unsolicited background, preemption, AI filler), drops the blocks
Jev marks as expendable. Called by .opencode/plugins/answer-guard.js on every
long assistant text part. Read-only on the draft: the caller decides whether
to apply `text`.

Usage:
  printf '%s' '{"prompt": "...", "draft": "..."}' | python3 guard.py
  python3 guard.py --in payload.json --fast
  python3 guard.py --selftest

`--fast` bounds the call for the hook path (2s timeout, no retries). Jev
unavailable means no opinion: the draft is returned untouched.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from jev import Jev, JevError, repo_root

# Calibration knobs (see AGENTS.md: record why before changing).
TRIM_OVER = 0.75       # over_answer probability that allows a trim
TRIM_FILLER = 0.75     # ai_speak probability that allows a trim
KEEP_BLOCK = 0.35      # blocks below this keep probability are dropped
ANSWERED_MIN = 0.6     # never trim a draft that is also incomplete
MIN_KEPT_RATIO = 0.3   # abort a trim that would remove most of the text
MAX_BLOCKS = 24        # above this, skip per-block trimming
PROMPT_CAP = 6000

HEADING_RE = re.compile(r"^#{1,6}\s")
FENCE_RE = re.compile(r"^(```|~~~)")

VERDICT_QUESTIONS = {
    "answered": {
        "type": "noul",
        "instructions": (
            "Does the draft answer every part of what the user actually asked, "
            "with nothing required missing?"
        ),
        "criteria": {"true": "all requested parts are answered", "false": "a requested part is missing"},
    },
    "over_answer": {
        "type": "noul",
        "instructions": (
            "Does the draft contain content the user did not ask for, such as preemptive "
            "background, unrequested alternatives, next steps, or a closing summary?"
        ),
        "criteria": {"true": "unsolicited extra content is present", "false": "only requested content"},
    },
    "ai_speak": {
        "type": "noul",
        "instructions": (
            "Does the draft contain AI filler, such as boilerplate openers or transitions, "
            "hedging, over-politeness, or decorative bullet lists for a simple answer?"
        ),
        "criteria": {"true": "filler is present", "false": "direct prose only"},
    },
}


def block_question(index):
    return {
        "type": "noul",
        "instructions": (
            "Is BLOCK %d necessary to answer the user's request? It is necessary when it "
            "carries the direct answer, evidence the user asked for, or requested detail. "
            "It is not necessary when it is background, preemption, repetition, or filler "
            "that can be removed without losing anything requested." % index
        ),
        "criteria": {"true": "necessary, keep", "false": "expendable, drop"},
    }


def split_blocks(text):
    blocks = []
    buf = []
    fence = False
    for line in text.split("\n"):
        if FENCE_RE.match(line.strip()):
            fence = not fence
        if not fence and not line.strip():
            if buf:
                blocks.append("\n".join(buf).strip("\n"))
                buf = []
        else:
            buf.append(line)
    if buf:
        blocks.append("\n".join(buf).strip("\n"))
    return [block for block in blocks if block.strip()]


def trim_blocks(blocks, keep_flags):
    out = []
    pending_heading = None
    for index, block in enumerate(blocks):
        if HEADING_RE.match(block):
            pending_heading = block
            continue
        if index == 0 or keep_flags[index]:
            if pending_heading is not None:
                out.append(pending_heading)
                pending_heading = None
            out.append(block)
    return "\n\n".join(out)


def build_state(prompt, blocks):
    lines = ["USER REQUEST:", prompt[:PROMPT_CAP].strip(), "", "DRAFT BLOCKS:"]
    for index, block in enumerate(blocks):
        lines.extend(["===BLOCK %d===" % index, block])
    return "\n".join(lines)


def guard(client, prompt, draft):
    blocks = split_blocks(draft)
    questions = dict(VERDICT_QUESTIONS)
    judge_blocks = 2 <= len(blocks) <= MAX_BLOCKS
    if judge_blocks:
        for index in range(len(blocks)):
            questions["keep_%d" % index] = block_question(index)

    if not client.available:
        return unavailable(draft)

    try:
        response = client.evaluate(build_state(prompt, blocks), questions, scrub_state=True)
    except JevError as error:
        result = unavailable(draft)
        result["error"] = str(error)
        return result

    answers = response["answers"]
    verdict = {name: round(float(answers[name]["noul"]), 4) for name in VERDICT_QUESTIONS}
    result = {
        "source": "jev",
        "verdict": verdict,
        "excessive": verdict["over_answer"] >= TRIM_OVER or verdict["ai_speak"] >= TRIM_FILLER,
        "trimmed": False,
        "dropped": [],
        "text": draft,
        "meta": {
            "model": response.get("model"),
            "cached": response.get("cached"),
            "latency_ms": response.get("latency_ms"),
        },
    }

    filler = max(verdict["over_answer"], verdict["ai_speak"])
    if not judge_blocks or filler < TRIM_OVER or verdict["answered"] < ANSWERED_MIN:
        log(prompt, draft, result)
        return result

    keep_flags = [float(answers["keep_%d" % index]["noul"]) >= KEEP_BLOCK for index in range(len(blocks))]
    trimmed = trim_blocks(blocks, keep_flags)
    dropped = [index for index in range(1, len(blocks)) if not keep_flags[index]]
    if dropped and len(trimmed) >= MIN_KEPT_RATIO * len(draft) and trimmed.strip():
        result["trimmed"] = True
        result["text"] = trimmed
        result["dropped"] = dropped
    log(prompt, draft, result)
    return result


def unavailable(draft):
    return {
        "source": "unavailable",
        "policy": "Jev unavailable: keep the draft as is; prevention rules in AGENTS.md still apply.",
        "excessive": False,
        "trimmed": False,
        "text": draft,
    }


def log(prompt, draft, result):
    try:
        directory = os.path.join(repo_root(), ".agents", ".cache", "guard")
        os.makedirs(directory, exist_ok=True)
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": result["source"],
            "verdict": result.get("verdict"),
            "dropped": result.get("dropped"),
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16],
            "draft_sha256": hashlib.sha256(draft.encode("utf-8")).hexdigest()[:16],
            "chars": len(draft),
            "meta": result.get("meta"),
        }
        with open(os.path.join(directory, "log.jsonl"), "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass


def selftest():
    def noul(value):
        return {"type": "noul", "noul": value}

    class FakeJev:
        available = True

        def __init__(self, answers):
            self.answers = answers
            self.questions = None

        def evaluate(self, state, questions, scrub_state=False, **kwargs):
            self.questions = questions
            for name in questions:
                assert name in self.answers, "missing fake answer: %s" % name
            return {"answers": self.answers, "model": "jev-test", "latency_ms": 1, "cached": False, "usage": {}}

    class Offline:
        available = False

    assert len(split_blocks("a\n\n```\nx\n\ny\n```\n\nb")) == 3
    assert len(split_blocks("one")) == 1

    draft = "はい、できます。\n\n## 補足\n\n昔からこうでした。\n\nやるなら A を実行します。"
    blocks = split_blocks(draft)
    assert len(blocks) == 4, blocks
    client = FakeJev({
        "answered": noul(0.9), "over_answer": noul(0.88), "ai_speak": noul(0.2),
        "keep_0": noul(0.9), "keep_1": noul(0.1), "keep_2": noul(0.1), "keep_3": noul(0.9),
    })
    result = guard(client, "できますか？", draft)
    assert result["trimmed"] is True, result
    assert result["text"] == "はい、できます。\n\n## 補足\n\nやるなら A を実行します。", result["text"]
    assert result["dropped"] == [1, 2], result
    assert len(client.questions) == 7, client.questions

    client = FakeJev({"answered": noul(0.9), "over_answer": noul(0.2), "ai_speak": noul(0.1),
                      "keep_0": noul(0.9), "keep_1": noul(0.1), "keep_2": noul(0.1), "keep_3": noul(0.9)})
    result = guard(client, "q", draft)
    assert result["trimmed"] is False and result["text"] == draft, result

    client = FakeJev({"answered": noul(0.3), "over_answer": noul(0.9), "ai_speak": noul(0.1),
                      "keep_0": noul(0.9), "keep_1": noul(0.1), "keep_2": noul(0.1), "keep_3": noul(0.9)})
    result = guard(client, "q", draft)
    assert result["trimmed"] is False, result

    client = FakeJev({"answered": noul(0.9), "over_answer": noul(0.9), "ai_speak": noul(0.9),
                      "keep_0": noul(0.9), "keep_1": noul(0.1), "keep_2": noul(0.1)})
    short = "はい。\n\n" + "前置きです。" * 40 + "\n\n" + "補足です。" * 40
    result = guard(client, "q", short)
    assert result["trimmed"] is False, "ratio guard must abort aggressive trims"

    long_single = "x" * 300
    client = FakeJev({"answered": noul(0.9), "over_answer": noul(0.9), "ai_speak": noul(0.1)})
    result = guard(client, "q", long_single)
    assert result["trimmed"] is False and len(client.questions) == 3, client.questions

    result = guard(Offline(), "q", draft)
    assert result["source"] == "unavailable" and result["text"] == draft, result

    class Failing:
        available = True

        def evaluate(self, *args, **kwargs):
            raise JevError("boom")

    result = guard(Failing(), "q", draft)
    assert result["source"] == "unavailable" and result["text"] == draft, result

    heading = "答え。\n\n# 余談\n\n昔の話。\n\n# 手順\n\nA を実行。"
    client = FakeJev({"answered": noul(0.9), "over_answer": noul(0.9), "ai_speak": noul(0.1),
                      "keep_0": noul(0.9), "keep_1": noul(0.1), "keep_2": noul(0.1),
                      "keep_3": noul(0.9), "keep_4": noul(0.9)})
    result = guard(client, "q", heading)
    assert result["text"] == "答え。\n\n# 手順\n\nA を実行。", result["text"]

    print("guard.py selftest: ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="input", help="JSON file with prompt and draft; - for stdin")
    parser.add_argument("--fast", action="store_true", help="short timeout, no retries (hook path)")
    parser.add_argument("--selftest", action="store_true", help="run the built-in self-check")
    args = parser.parse_args()

    if args.selftest:
        selftest()
        return 0

    raw = sys.stdin.read() if not args.input or args.input == "-" else open(args.input, encoding="utf-8").read()
    try:
        payload = json.loads(raw)
    except ValueError as error:
        parser.error("invalid JSON: %s" % error)
    prompt = payload.get("prompt") or ""
    draft = payload.get("draft") or ""
    if not prompt.strip() or not draft.strip():
        parser.error("payload needs non-empty prompt and draft")

    client = Jev(timeout=2.0, retries=0) if args.fast else Jev()
    print(json.dumps(guard(client, prompt, draft), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
