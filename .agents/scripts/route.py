#!/usr/bin/env python3
"""Jev-first prompt router for the cowork agent distro.

One Jev call per user turn answers every routing question in parallel:
safety override, playbook choice, per-skill usefulness, clarification
need, delegation, verification, and artifact format. When Jev is
unavailable the deterministic keyword scorer below answers the same
call, so the distro works offline.

Usage:
  printf '%s' "$PROMPT" | python3 route.py --routing .agents/routing.json --json
  python3 route.py --routing works/finance/.agents/routing.json "prompt"
  python3 route.py --routing .agents/routing.json --list
  python3 route.py --selftest

Env: TYPESAFE_API_KEY enables Jev; absent means keyword mode.
"""

import argparse
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from jev import Jev, JevError

STRONG = 3
WEAK = 1
PATTERN = 2
MIN_SCORE = 3
HIGH_SCORE = 6
HIGH_GAP = 3

JEV_ACT = 0.80
JEV_REVIEW = 0.55
SKILL_THRESHOLD = 0.65
SAFETY_THRESHOLD = 0.35
CLARIFY_THRESHOLD = 0.75
DELEGATE_THRESHOLD = 0.65
VERIFY_THRESHOLD = 0.65
FORMAT_THRESHOLD = 0.55

FORMAT_SKILLS = {
    "xlsx": "../../.agents/skills/xlsx",
    "docx": "../../.agents/skills/docx",
    "pdf": "../../.agents/skills/pdf",
    "pptx": "../../.agents/skills/pptx",
}


def normalize(text):
    return unicodedata.normalize("NFKC", text).lower()


def keyword_hit(text, keyword):
    keyword = normalize(keyword)
    if not keyword:
        return False
    if keyword.isascii():
        return (
            re.search(r"(?<![a-z0-9])" + re.escape(keyword) + r"(?![a-z0-9])", text)
            is not None
        )
    return keyword in text


def score_rule(text, rule):
    score = 0
    terms = []
    keywords = rule.get("keywords", {})
    for keyword in keywords.get("strong", []):
        if keyword_hit(text, keyword):
            score += STRONG
            terms.append({"term": keyword, "weight": STRONG})
    for keyword in keywords.get("weak", []):
        if keyword_hit(text, keyword):
            score += WEAK
            terms.append({"term": keyword, "weight": WEAK})
    for pattern in rule.get("patterns", []):
        try:
            matched = re.search(pattern, text) is not None
        except re.error:
            matched = False
        if matched:
            score += PATTERN
            terms.append({"term": pattern, "weight": PATTERN})
    return score, terms


def route_entry(rule, score, terms):
    return {
        "id": rule["id"],
        "title": rule.get("title", rule["id"]),
        "score": score,
        "hits": terms,
        "root": rule.get("root"),
        "playbook": rule.get("playbook"),
        "skills": [strip_skill(skill) for skill in rule.get("skills", [])],
        "approval": rule.get("approval", "none"),
        "escalation": rule.get("escalation"),
        "notes": rule.get("notes"),
    }


def strip_skill(skill):
    return skill.split("/")[-1]


def rule_criteria(rule):
    title = rule.get("title", rule["id"])
    notes = rule.get("notes")
    return "%s。%s" % (title, notes) if notes else title


def routing_dir(routing_path):
    return os.path.dirname(os.path.abspath(routing_path))


def skill_description(base, skill):
    path = os.path.join(base, "skills", skill, "SKILL.md")
    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        return ""
    match = re.match(r"^---\n(.*?)\n---", text, re.S)
    if not match:
        return ""
    for line in match.group(1).splitlines():
        if line.startswith("description:"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return ""


def keyword_decide(prompt, routing):
    text = normalize(prompt)
    scored = []
    for rule in routing.get("rules", []):
        score, terms = score_rule(text, rule)
        if score > 0:
            scored.append((rule, score, terms))

    overrides = [item for item in scored if item[0].get("override")]
    overrides.sort(key=lambda item: item[1], reverse=True)
    candidates = [
        route_entry(r, s, t)
        for r, s, t in sorted(scored, key=lambda i: i[1], reverse=True)
    ]

    if overrides:
        rule, score, terms = overrides[0]
        return {
            "decision": "override",
            "confidence": "high",
            "route": route_entry(rule, score, terms),
            "candidates": candidates,
            "skills": [strip_skill(skill) for skill in rule.get("skills", [])],
            "agents": [],
            "format": None,
            "signals": {},
            "clarify_questions": [],
        }

    if not scored or scored[0][1] < MIN_SCORE:
        return clarify_result(routing, candidates)
    top_rule, top_score, top_terms = scored[0]
    second_score = scored[1][1] if len(scored) > 1 else 0
    if top_score == second_score:
        return clarify_result(routing, candidates)

    confidence = (
        "high"
        if top_score >= HIGH_SCORE and top_score - second_score >= HIGH_GAP
        else "medium"
    )
    return {
        "decision": "route",
        "confidence": confidence,
        "route": route_entry(top_rule, top_score, top_terms),
        "candidates": candidates,
        "skills": [strip_skill(skill) for skill in top_rule.get("skills", [])],
        "agents": [],
        "format": None,
        "signals": {},
        "clarify_questions": [],
    }


def clarify_result(routing, candidates):
    return {
        "decision": "clarify",
        "confidence": "low",
        "route": None,
        "candidates": candidates,
        "skills": [],
        "agents": [],
        "format": None,
        "signals": {},
        "clarify_questions": routing.get("clarify", {}).get("questions", []),
    }


def collect_skills(routing):
    names = []
    for rule in routing.get("rules", []):
        for skill in rule.get("skills", []):
            name = strip_skill(skill)
            if name not in names:
                names.append(name)
    return names


def build_questions(routing, base):
    questions = {}
    rules = routing.get("rules", [])
    overrides = [rule for rule in rules if rule.get("override")]
    domain = routing.get("domain", "this domain")

    if overrides:
        criteria = {rule["id"]: rule_criteria(rule) for rule in overrides}
        criteria["none"] = "安全上の緊急対応ではない"
        questions["safety"] = {
            "type": "choice",
            "instructions": "この依頼は安全上の緊急対応（詐欺、救急、期限、刑事など）に該当しますか。該当する場合は最も近い分類を1つ、どれにも該当しなければ none を選ぶ。",
            "criteria": criteria,
        }

    criteria = {rule["id"]: rule_criteria(rule) for rule in rules}
    criteria["clarify"] = "どれにも当てはまらない、または判断に必要な情報が足りない"
    questions["playbook"] = {
        "type": "choice",
        "instructions": "%s の依頼として、最も適した業務フローを1つ選ぶ。該当がなければ clarify。"
        % domain,
        "criteria": criteria,
    }

    for skill in collect_skills(routing):
        description = skill_description(base, skill)
        questions["skill:" + skill] = {
            "type": "noul",
            "instructions": "この依頼を遂行するために専門知識モジュール `%s` を読む必要がありますか。%s"
            % (skill, description),
            "criteria": {
                "true": "このモジュールの知識が作業に必要",
                "false": "この依頼には不要",
            },
        }

    questions["clarify"] = {
        "type": "noul",
        "instructions": "作業を始める前にユーザーへ確認すべき前提（対象、目的、期限、立場、成果物）が不足していますか。",
        "criteria": {
            "true": "前提が不足し、推測で進めると誤りや手戻りの危険がある",
            "false": "会話と依頼から前提を十分に特定できる",
        },
    }
    questions["delegate"] = {
        "type": "noul",
        "instructions": "この依頼には大量の資料処理、文献スクリーニング、データ整理など、サブエージェントに委任して要約だけを受け取るべき作業が含まれますか。",
        "criteria": {
            "true": "入力量が多く、委任した方が速く正確",
            "false": "primary が直接扱える規模",
        },
    }
    questions["verify"] = {
        "type": "noul",
        "instructions": "この依頼は、回答をユーザーに返す前に独立した検証（引用、計算、安全性の再確認）を行う必要がありますか。",
        "criteria": {
            "true": "誤りが金銭・健康・法的結果に影響するため独立検証が必要",
            "false": "通常の自己確認で足りる",
        },
    }
    questions["format"] = {
        "type": "choice",
        "instructions": "最終成果物に最も適した形式を1つ選ぶ。ファイルが不要で会話内の回答で完結する場合は none。",
        "criteria": {
            "none": "会話内の回答で完結する",
            "markdown": "会話内に構造化した文書を返す",
            "xlsx": "表計算（集計、家計、資産、検査値、実験結果）",
            "docx": "Word 文書（契約書、方針書、報告書、草稿）",
            "pdf": "PDF（フォーム記入、配布用の確定文書）",
            "pptx": "スライド（説明資料、プレゼン）",
        },
    }
    return questions


def find_rule(routing, rule_id):
    for rule in routing.get("rules", []):
        if rule["id"] == rule_id:
            return rule
    return None


def route_with_jev(prompt, routing, base, client):
    questions = build_questions(routing, base)
    response = client.evaluate(prompt, questions, scrub_state=True)
    answers = response["answers"]
    signals = {}

    safety = answers.get("safety")
    if safety is not None:
        chosen = safety["choice"]
        probability = float(safety.get("probabilities", {}).get(chosen, 0.0))
        signals["safety"] = {"choice": chosen, "probability": round(probability, 4)}
        if chosen != "none" and probability >= SAFETY_THRESHOLD:
            rule = find_rule(routing, chosen)
            if rule is not None:
                result = keyword_decide(prompt, routing)
                result.update(
                    {
                        "decision": "override",
                        "confidence": "high",
                        "route": route_entry(
                            rule, 0, [{"term": "jev:safety", "weight": 0}]
                        ),
                        "skills": [
                            strip_skill(skill) for skill in rule.get("skills", [])
                        ],
                        "signals": signals,
                    }
                )
                result["meta"] = meta_of(response, "jev")
                return result

    clarify_probability = (
        float(answers["clarify"]["noul"]) if "clarify" in answers else 0.0
    )
    signals["clarify"] = round(clarify_probability, 4)
    playbook = answers["playbook"]
    chosen = playbook["choice"]
    confidence = float(playbook.get("confidence", 0.0))
    signals["playbook"] = {"choice": chosen, "confidence": round(confidence, 4)}

    if (
        clarify_probability >= CLARIFY_THRESHOLD
        or chosen == "clarify"
        or confidence < JEV_REVIEW
    ):
        result = clarify_result(routing, [])
        result["signals"] = signals
        result["meta"] = meta_of(response, "jev")
        return result

    rule = find_rule(routing, chosen)
    if rule is None:
        result = clarify_result(routing, [])
        result["signals"] = signals
        result["meta"] = meta_of(response, "jev")
        return result

    rule_skills = [strip_skill(skill) for skill in rule.get("skills", [])]
    skill_probabilities = {}
    for name, answer in answers.items():
        if name.startswith("skill:"):
            skill_probabilities[name.split(":", 1)[1]] = round(float(answer["noul"]), 4)
    selected = [
        name
        for name, probability in skill_probabilities.items()
        if probability >= SKILL_THRESHOLD
    ]
    merged = list(dict.fromkeys(rule_skills + selected))[:5]
    signals["skills"] = skill_probabilities

    delegate = float(answers["delegate"]["noul"]) if "delegate" in answers else 0.0
    verify = float(answers["verify"]["noul"]) if "verify" in answers else 0.0
    signals["delegate"] = round(delegate, 4)
    signals["verify"] = round(verify, 4)
    agents = []
    if delegate >= DELEGATE_THRESHOLD:
        agents.append("worker")
    if verify >= VERIFY_THRESHOLD:
        agents.append("verifier")

    artifact = None
    format_answer = answers.get("format")
    if format_answer is not None:
        format_choice = format_answer["choice"]
        format_confidence = float(format_answer.get("confidence", 0.0))
        signals["format"] = {
            "choice": format_choice,
            "confidence": round(format_confidence, 4),
        }
        if format_choice in FORMAT_SKILLS and format_confidence >= FORMAT_THRESHOLD:
            artifact = {"choice": format_choice, "skill": FORMAT_SKILLS[format_choice]}

    confidence_label = "high" if confidence >= JEV_ACT else "medium"
    return {
        "decision": "route",
        "confidence": confidence_label,
        "route": route_entry(rule, 0, [{"term": "jev:playbook", "weight": 0}]),
        "candidates": keyword_decide(prompt, routing)["candidates"],
        "skills": merged,
        "agents": agents,
        "format": artifact,
        "signals": signals,
        "clarify_questions": [],
        "meta": meta_of(response, "jev"),
    }


def meta_of(response, source):
    return {
        "source": source,
        "model": response.get("model"),
        "cached": response.get("cached"),
        "latency_ms": response.get("latency_ms"),
        "usage": response.get("usage", {}),
    }


def route_prompt(prompt, routing, base, client=None, offline=False):
    if client is None:
        client = Jev()
    if not offline and client.available:
        try:
            return route_with_jev(prompt, routing, base, client)
        except JevError as error:
            result = keyword_decide(prompt, routing)
            result["fallback_reason"] = str(error)
            result["meta"] = {"source": "keyword"}
            return result
    result = keyword_decide(prompt, routing)
    result["meta"] = {
        "source": "keyword",
        "reason": "jev disabled" if offline else "TYPESAFE_API_KEY not set",
    }
    return result


def cowork_path(name):
    tools = os.path.dirname(os.path.abspath(__file__))
    agents = os.path.dirname(tools)
    return os.path.relpath(os.path.join(agents, name), os.getcwd())


def instructions(result):
    if result["decision"] == "override":
        route = result["route"]
        text = "Safety override. Follow %s now." % route["playbook"]
        if route.get("escalation"):
            text += " Escalate: %s" % route["escalation"]
        return text
    if result["decision"] == "route":
        route = result["route"]
        parts = [
            "Load %s. Skills: %s."
            % (route["playbook"], ", ".join(result["skills"]) or "(none)"),
            "Reply as the primary agent; never expose routing to the user.",
        ]
        if route.get("approval") == "confirm":
            parts.append("Confirm the assumptions with the user before finalizing.")
        if "worker" in result.get("agents", []):
            parts.append("Delegate bulk work per %s." % cowork_path("agents/worker.md"))
        if "verifier" in result.get("agents", []):
            parts.append(
                "Verify per %s before sending." % cowork_path("agents/verifier.md")
            )
        if result.get("format"):
            parts.append(
                "Artifact: %s via %s."
                % (result["format"]["choice"], result["format"]["skill"])
            )
        parts.append(
            "Before final: python3 %s grounded cites_sources safety_disclosure."
            % cowork_path("scripts/decide.py")
        )
        return " ".join(parts)
    return "Not confident. Ask the clarifying questions before doing any work."


def pretty(routing, result):
    lines = []
    lines.append("domain     : %s" % (routing.get("domain") or "-"))
    lines.append("decision   : %s" % result["decision"])
    lines.append("confidence : %s" % result["confidence"])
    lines.append("source     : %s" % result.get("meta", {}).get("source", "keyword"))
    if result["route"]:
        route = result["route"]
        lines.append("route      : %s (%s)" % (route["id"], route["title"]))
        if route.get("root"):
            lines.append("root       : %s" % route["root"])
        lines.append("playbook   : %s" % route["playbook"])
        lines.append("approval   : %s" % route["approval"])
        if route.get("escalation"):
            lines.append("escalation : %s" % route["escalation"])
    if result.get("skills"):
        lines.append("skills     : %s" % ", ".join(result["skills"]))
    if result.get("agents"):
        lines.append("agents     : %s" % ", ".join(result["agents"]))
    if result.get("format"):
        lines.append(
            "format     : %s (%s)"
            % (result["format"]["choice"], result["format"]["skill"])
        )
    if result.get("signals"):
        signals = []
        for key, value in result["signals"].items():
            if isinstance(value, dict):
                signals.append(
                    "%s=%s(%.2f)"
                    % (
                        key,
                        value.get("choice"),
                        value.get("confidence", value.get("probability", 0)),
                    )
                )
            else:
                signals.append("%s=%.2f" % (key, value))
        lines.append("signals    : %s" % ", ".join(signals))
    if result["clarify_questions"]:
        lines.append("clarify:")
        for question in result["clarify_questions"]:
            lines.append("  - %s" % question)
    if result.get("fallback_reason"):
        lines.append("fallback   : %s" % result["fallback_reason"])
    lines.append("next       : %s" % instructions(result))
    return "\n".join(lines)


def selftest():
    routing = {
        "domain": "test",
        "rules": [
            {
                "id": "scam",
                "title": "scam",
                "override": True,
                "keywords": {"strong": ["元本保証", "絶対儲かる"], "weak": ["投資"]},
                "patterns": [r"(必ず|絶対).{0,4}(儲|増え)"],
                "playbook": "playbooks/scam.md",
                "skills": ["skills/scam-patterns"],
                "approval": "escalate",
                "escalation": "188",
            },
            {
                "id": "portfolio",
                "title": "portfolio",
                "keywords": {
                    "strong": ["ポートフォリオ", "資産の棚卸し"],
                    "weak": ["資産", "保有"],
                },
                "playbook": "playbooks/portfolio.md",
                "skills": ["skills/portfolio-analysis"],
                "approval": "none",
            },
            {
                "id": "tax",
                "title": "tax",
                "keywords": {"strong": ["ideco", "ふるさと納税"], "weak": ["税金"]},
                "playbook": "playbooks/tax.md",
                "skills": ["skills/japan-tax-systems"],
                "approval": "confirm",
            },
        ],
        "clarify": {"questions": ["what do you want to do?"]},
    }

    result = keyword_decide("ポートフォリオの内訳を確認したい", routing)
    assert result["decision"] == "route" and result["route"]["id"] == "portfolio", (
        result
    )

    result = keyword_decide("元本保証で必ず儲かる投資の紹介", routing)
    assert result["decision"] == "override" and result["route"]["id"] == "scam", result

    result = keyword_decide("ideco と ふるさと納税 どっち", routing)
    assert result["decision"] == "route" and result["confidence"] == "high", result

    result = keyword_decide("こんにちは", routing)
    assert result["decision"] == "clarify" and result["route"] is None, result

    routing["rules"][1]["keywords"]["weak"] = ["資産", "保有", "ideco"]
    result = keyword_decide("ideco 資産 保有", routing)
    assert result["decision"] == "clarify", result

    class FakeJev:
        available = True

        def __init__(self, answers):
            self.answers = answers

        def evaluate(self, state, questions, scrub_state=False, **kwargs):
            return {
                "model": "jev-test",
                "answers": self.answers,
                "usage": {"input_tokens": 100, "output_tokens": 0},
                "cached": False,
                "latency_ms": 120,
            }

    def answers_for(
        playbook="portfolio",
        playbook_confidence=0.9,
        safety="none",
        safety_probability=0.9,
        clarify=0.05,
        delegate=0.8,
        verify=0.4,
        format_choice="none",
        format_confidence=0.8,
        skills=None,
    ):
        skills = skills or {
            "portfolio-analysis": 0.9,
            "japan-tax-systems": 0.1,
            "scam-patterns": 0.05,
        }
        answers = {
            "safety": {
                "type": "choice",
                "choice": safety,
                "probabilities": {
                    safety: safety_probability,
                    "none": 1 - safety_probability,
                },
                "confidence": safety_probability,
            },
            "playbook": {
                "type": "choice",
                "choice": playbook,
                "probabilities": {playbook: playbook_confidence},
                "confidence": playbook_confidence,
            },
            "clarify": {"type": "noul", "noul": clarify},
            "delegate": {"type": "noul", "noul": delegate},
            "verify": {"type": "noul", "noul": verify},
            "format": {
                "type": "choice",
                "choice": format_choice,
                "probabilities": {format_choice: format_confidence},
                "confidence": format_confidence,
            },
        }
        for name, probability in skills.items():
            answers["skill:" + name] = {"type": "noul", "noul": probability}
        return answers

    fake = FakeJev(answers_for())
    result = route_with_jev("資産の内訳を確認したい", routing, "/tmp", fake)
    assert result["decision"] == "route" and result["route"]["id"] == "portfolio", (
        result
    )
    assert result["confidence"] == "high", result
    assert "portfolio-analysis" in result["skills"], result
    assert "worker" in result["agents"] and "verifier" not in result["agents"], result
    assert result["meta"]["source"] == "jev" and result["meta"]["latency_ms"] == 120, (
        result
    )
    assert "decide.py grounded cites_sources safety_disclosure" in instructions(
        result
    ), instructions(result)

    fake = FakeJev(answers_for(safety="scam", safety_probability=0.88))
    result = route_with_jev("元本保証の投資を紹介された", routing, "/tmp", fake)
    assert result["decision"] == "override" and result["route"]["id"] == "scam", result
    assert result["skills"] == ["scam-patterns"], result

    fake = FakeJev(answers_for(playbook_confidence=0.3))
    result = route_with_jev("何かいい感じに", routing, "/tmp", fake)
    assert result["decision"] == "clarify", result

    fake = FakeJev(answers_for(clarify=0.95))
    result = route_with_jev("資産の内訳を確認したい", routing, "/tmp", fake)
    assert result["decision"] == "clarify", result

    fake = FakeJev(answers_for(format_choice="xlsx", format_confidence=0.9))
    result = route_with_jev("資産を集計して", routing, "/tmp", fake)
    assert result["format"] and result["format"]["choice"] == "xlsx", result

    class BrokenJev:
        available = True

        def evaluate(self, *args, **kwargs):
            raise JevError("HTTP 500: down")

    result = route_prompt("ポートフォリオを確認", routing, "/tmp", client=BrokenJev())
    assert result["decision"] == "route" and result["meta"]["source"] == "keyword", (
        result
    )
    assert result["fallback_reason"] == "HTTP 500: down", result

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "skills", "portfolio-analysis"))
        with open(
            os.path.join(tmp, "skills", "portfolio-analysis", "SKILL.md"),
            "w",
            encoding="utf-8",
        ) as handle:
            handle.write(
                "---\nname: portfolio-analysis\ndescription: 資産の棚卸しと集計。\n---\n\nbody\n"
            )
        questions = build_questions(routing, tmp)
        assert "skill:portfolio-analysis" in questions, questions
        assert (
            "資産の棚卸しと集計"
            in questions["skill:portfolio-analysis"]["instructions"]
        ), questions

    print("route.py selftest: ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "prompt", nargs="?", help="user prompt; reads stdin when omitted"
    )
    parser.add_argument("--routing", help="path to a routing.json taxonomy")
    parser.add_argument(
        "--json", action="store_true", help="emit machine-readable JSON"
    )
    parser.add_argument(
        "--list", action="store_true", help="list rules in the taxonomy"
    )
    parser.add_argument(
        "--offline", action="store_true", help="skip Jev and use keyword scoring"
    )
    parser.add_argument(
        "--selftest", action="store_true", help="run the built-in self-check"
    )
    args = parser.parse_args()

    if args.selftest:
        selftest()
        return 0

    if not args.routing:
        parser.error("--routing is required")

    with open(args.routing, encoding="utf-8") as handle:
        routing = json.load(handle)
    base = routing_dir(args.routing)

    if args.list:
        for rule in routing.get("rules", []):
            print("%s\t%s" % (rule["id"], rule.get("title", "")))
        return 0

    prompt = args.prompt
    if prompt is None:
        prompt = sys.stdin.read()
    prompt = prompt.strip()
    if not prompt:
        parser.error("empty prompt")

    result = route_prompt(prompt, routing, base, offline=args.offline)
    result["domain"] = routing.get("domain")
    result["prompt"] = prompt
    result["instructions"] = instructions(result)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(pretty(routing, result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
