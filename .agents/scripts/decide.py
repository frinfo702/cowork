#!/usr/bin/env python3
"""Run cowork runtime decisions through Jev.

Every mid-task gate (should I escalate, is the answer grounded, which
agent, which artifact format) is one typed question in one Jev call.

Usage:
  printf '%s' "$DRAFT" | python3 decide.py grounded cites_sources safety_disclosure
  python3 decide.py delegate --state "調査対象の論文が200本あり、要約を作る"
  python3 decide.py escalate --state-file /tmp/situation.md --log data/decisions.jsonl
  python3 decide.py --list
  python3 decide.py --selftest

Exit code is 0 whether or not the gate passes; read `pass` and `answer`
from the JSON. When Jev is unavailable the result carries
`"source": "unavailable"` and the catalog's policy text.
"""

import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from jev import Jev, JevError, repo_root


def default_catalog():
    return os.path.join(repo_root(), ".agents", "decisions.json")


def load_catalog(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def build_questions(catalog, ids):
    questions = {}
    for decision_id in ids:
        spec = catalog["decisions"].get(decision_id)
        if spec is None:
            raise SystemExit("unknown decision: %s (see --list)" % decision_id)
        question = {"type": spec["type"], "instructions": spec["instructions"]}
        if spec["type"] in ("choice", "score"):
            question["criteria"] = spec["criteria"]
        elif spec.get("criteria"):
            question["criteria"] = spec["criteria"]
        questions[decision_id] = question
    return questions


def evaluate(catalog, ids, state, client, threshold=None):
    threshold = float(threshold if threshold is not None else catalog.get("default_threshold", 0.8))
    questions = build_questions(catalog, ids)
    results = {}
    if not client.available:
        for decision_id in ids:
            spec = catalog["decisions"][decision_id]
            results[decision_id] = {
                "type": spec["type"],
                "answer": None,
                "pass": None,
                "source": "unavailable",
                "policy": spec.get("policy", ""),
            }
        return results, {"source": "unavailable"}
    try:
        response = client.evaluate(state, questions, scrub_state=True)
    except JevError as error:
        for decision_id in ids:
            spec = catalog["decisions"][decision_id]
            results[decision_id] = {
                "type": spec["type"],
                "answer": None,
                "pass": None,
                "source": "unavailable",
                "policy": spec.get("policy", ""),
                "error": str(error),
            }
        return results, {"source": "unavailable", "error": str(error)}

    for decision_id in ids:
        spec = catalog["decisions"][decision_id]
        answer = response["answers"][decision_id]
        if spec["type"] == "noul":
            probability = float(answer["noul"])
            passed = probability >= threshold
            results[decision_id] = {
                "type": "noul",
                "answer": passed,
                "probability": round(probability, 4),
                "threshold": threshold,
                "pass": passed,
                "source": "jev",
                "action": spec.get("actions", {}).get("true" if passed else "false", ""),
            }
        else:
            confidence = float(answer.get("confidence", 0.0))
            chosen = answer.get("choice", answer.get("score"))
            passed = confidence >= threshold
            results[decision_id] = {
                "type": spec["type"],
                "answer": chosen,
                "confidence": round(confidence, 4),
                "probabilities": answer.get("probabilities", {}),
                "threshold": threshold,
                "pass": passed,
                "source": "jev",
                "action": spec.get("actions", {}).get(str(chosen), ""),
            }
    meta = {
        "source": "jev",
        "model": response.get("model"),
        "cached": response.get("cached"),
        "latency_ms": response.get("latency_ms"),
        "usage": response.get("usage", {}),
    }
    return results, meta


def append_log(path, ids, state, results, meta):
    try:
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        entry = {
            "ts": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
            "state_sha256": hashlib.sha256(state.encode("utf-8")).hexdigest()[:16],
            "decisions": {key: {k: value[k] for k in ("answer", "confidence", "probability", "source") if k in value} for key, value in results.items()},
            "meta": meta,
        }
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass


def resolve_log(path):
    if path:
        return path
    if os.path.isdir("data"):
        return os.path.join("data", "decisions.jsonl")
    return None


def selftest():
    catalog = load_catalog(default_catalog())
    ids = sorted(catalog["decisions"].keys())
    assert "grounded" in ids and "delegate" in ids and "escalate" in ids, ids

    class FakeJev:
        available = True

        def __init__(self, answers):
            self.answers = answers

        def evaluate(self, state, questions, scrub_state=False, **kwargs):
            assert set(questions) == {"grounded", "delegate"}, questions
            return {
                "model": "jev-test",
                "answers": self.answers,
                "usage": {},
                "cached": False,
                "latency_ms": 12,
            }

    fake = FakeJev({
        "grounded": {"type": "noul", "noul": 0.93},
        "delegate": {
            "type": "choice",
            "choice": "worker",
            "probabilities": {"self": 0.1, "worker": 0.8, "verifier": 0.1},
            "confidence": 0.7,
        },
    })
    results, meta = evaluate(catalog, ["grounded", "delegate"], "draft text", fake)
    assert results["grounded"]["pass"] is True, results
    assert results["grounded"]["action"], results
    assert results["delegate"]["answer"] == "worker" and results["delegate"]["pass"] is False, results
    assert meta["source"] == "jev", meta

    class Offline:
        available = False

    results, meta = evaluate(catalog, ["clarify"], "text", Offline())
    assert results["clarify"]["source"] == "unavailable", results
    assert results["clarify"]["answer"] is None, results
    assert results["clarify"]["policy"], results

    questions = build_questions(catalog, ["escalate"])
    assert questions["escalate"]["criteria"]["true"], questions

    try:
        build_questions(catalog, ["nope"])
        raise AssertionError("unknown decision must fail")
    except SystemExit:
        pass

    print("decide.py selftest: ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("decisions", nargs="*", help="decision ids from the catalog")
    parser.add_argument("--state", help="state text; reads stdin when omitted")
    parser.add_argument("--state-file", help="read state from a file; - for stdin")
    parser.add_argument("--catalog", default=default_catalog(), help="decision catalog path")
    parser.add_argument("--threshold", type=float, help="pass threshold (default from catalog)")
    parser.add_argument("--log", help="append a decision record to this JSONL path")
    parser.add_argument("--list", action="store_true", help="list available decisions")
    parser.add_argument("--selftest", action="store_true", help="run the built-in self-check")
    args = parser.parse_args()

    if args.selftest:
        selftest()
        return 0

    catalog = load_catalog(args.catalog)

    if args.list:
        for decision_id, spec in catalog["decisions"].items():
            print("%s\t%s\t%s" % (decision_id, spec["type"], spec["instructions"][:80]))
        return 0

    if not args.decisions:
        parser.error("at least one decision id is required (see --list)")

    if args.state_file:
        state = sys.stdin.read() if args.state_file == "-" else open(args.state_file, encoding="utf-8").read()
    elif args.state:
        state = args.state
    else:
        state = sys.stdin.read()
    if not state.strip():
        parser.error("empty state")

    client = Jev()
    results, meta = evaluate(catalog, args.decisions, state, client, threshold=args.threshold)
    payload = {"decisions": results, "meta": meta}
    log_path = resolve_log(args.log)
    if log_path:
        append_log(log_path, args.decisions, state, results, meta)
        payload["logged"] = log_path
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
