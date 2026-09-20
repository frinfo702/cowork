# cowork

A monorepo for delegating personal life to agents. It takes the ideas of Claude Cowork / GPT work and implements them as independent agent distros, one per domain.

The user always talks to a single primary agent. Every decision runs through typed classification by TypeSafe Jev (`jev-latest`), and behavior changes with probability and confidence. When Jev is unavailable, a deterministic router returns the same judgment.

## Layout

```
AGENTS.md                      this file. The monorepo-wide contract
.opencode/plugins/
  answer-guard.js              reply hooks. Inspects output with Jev and trims overblocking
.agents/
  scripts/jev.py               Jev client (cache, redaction, retries, validation)
  scripts/guard.py             reply guard (answered/over_answer/ai_speak and block triage)
  scripts/route.py             Jev-first router (one call decides playbook/skills/agent/format)
  scripts/decide.py            runtime decision catalog (escalate, grounded, delegate, ...)
  decisions.json               decision catalog (Jev question definitions and offline policy)
  routing.json                 domain router classification data
  agents/worker.md             delegation worker (pstack agent setup)
  agents/verifier.md           read-only independent verifier
  skills/                      shared skills (prefer copies of official skills)
    typesafe-ai/               official TypeSafe skill
    principle-*/               pstack-style operating principles
works/
  finance/AGENTS.md            finance and asset management primary agent contract
  finance/.agents/
    routing.json               business router classification data
    playbooks/*.md             business flows (routing targets)
    skills/*/SKILL.md          domain knowledge modules
  legal/                       law and contracts (same setup)
  medical/                     health and medicine (same setup)
  ml-research/                 ML research (same setup)
```

Each `works/<domain>/` has no `.git`, but is developed as if it were an independent repository, so it stays self-contained. Only shared skills live in `.agents/skills/`, and domains read them through the relative path `../../.agents/skills/`.

## primary-only principle

1. The user talks to the primary agent and nobody else. Subagents never address the user. Never tell the user to "ask another agent".
2. Decide every turn by running `route.py` first, and `decide.py` while working. Never guess a playbook.
3. Follow the router's `decision`.
   - `override`: a safety override. Follow the playbook immediately and present `escalation`.
   - `route`: read `playbook` and `skills`, delegate per `agents`, and build the deliverable per `format`.
   - `clarify`: ask only `clarify_questions`. Do not start work.
4. The primary agent's scope is research, analysis, planning, and document drafts. Irreversible actions such as signing contracts, sending money, executing trades, and posting are done by the user.
5. Write personal data (asset amounts, contract terms, symptoms, research data) only under `works/<domain>/data/`. Never write it to tracked files such as `.agents/` or routing.json. State sent to Jev is redacted automatically by `route.py` / `decide.py`.

## Reply discipline

1. Answer only what was asked. Do not add background, anticipatory advice, alternatives, next steps, or summaries. When something is unclear, the user asks again.
2. Do not explain everything at once. Simple questions get 1-3 sentences; use bullets only when steps or comparisons require them.
3. No preambles, no restating the question, no disclaimers, no "how does that sound?". Follow the `unslop` skill.
4. Completion reports contain only what was done, verification results, and findings.
5. Replies of 240 characters or more are inspected by `.opencode/plugins/answer-guard.js` at `text.complete` via Jev, which trims overblocking. Judgment logs live in `.agents/.cache/guard/log.jsonl`. After an overblock, the next turn's system prompt carries a note. When `TYPESAFE_API_KEY` is unset, nothing happens.

## Decision architecture

Every runtime judgment reduces to Jev's 3 primitives (noul / choice / score). They are evaluated in parallel in one request and return in 70-500 ms.

### 1. Turn start: `route.py`

```sh
printf '%s' "$PROMPT" | python3 .agents/scripts/route.py --routing .agents/routing.json --json
```

One call decides all of the following at once.

| question | type | purpose |
|---|---|---|
| `safety` | choice | detect safety overrides (fraud, emergency, deadline, criminal) |
| `playbook` | choice | select the business flow |
| `skill:*` | noul | whether to read each domain knowledge module |
| `clarify` | noul | whether missing premises require asking the user |
| `delegate` | noul | whether to delegate to a subagent |
| `verify` | noul | whether independent verification is needed |
| `format` | choice | deliverable format (xlsx / docx / pdf / pptx) |

### 2. While working: `decide.py`

```sh
printf '%s' "$DRAFT" | python3 .agents/scripts/decide.py grounded cites_sources safety_disclosure
python3 .agents/scripts/decide.py delegate --state "200 papers to review"
```

The catalog is `.agents/decisions.json`. List it with `--list`. When Jev is unavailable, it returns `"source": "unavailable"` plus a policy, and you follow that policy.

### 3. Confidence bands

| confidence | action |
|---|---|
| ≥ 0.80 | act. Proceed as is |
| 0.55 - 0.80 | confirm. Check the premises before proceeding |
| < 0.55 | clarify. Ask, or present multiple options |

Safety overrides fire at 0.35. Thresholds live in `route.py` / `decisions.json`; when you calibrate them with domain data, record the reason and change them there.

### 4. Offline

When `TYPESAFE_API_KEY` is unset, or Jev errors or times out, `route.py` falls back to the keyword router and returns `meta.source: "keyword"`. `decide.py` returns a policy. The API key exists only as an environment variable. Never write it to a file.

### 5. Judgments not in the catalog

For runtime judgments not in `decisions.json` (which skill to read first, whether a draft is safe to send, and so on), ask `jev.py` directly. You may put multiple questions in one call.

```sh
printf '%s' '{"state": "…", "questions": {"next_step": {"type": "choice", "instructions": "…", "criteria": {"a": "…", "b": "…"}}}}' | python3 .agents/scripts/jev.py --scrub
```

## Starting a session

A request received at the monorepo root:

```sh
printf '%s' "$PROMPT" | python3 .agents/scripts/route.py --routing .agents/routing.json --json
```

The `root` in the output is the owning domain. Read `works/<domain>/AGENTS.md` and follow its contract. Inside the domain, route again:

```sh
printf '%s' "$PROMPT" | python3 ../../.agents/scripts/route.py --routing .agents/routing.json --json
```

When you open a domain folder on its own, that folder's `AGENTS.md` is the entry point. The router itself lives at `../../.agents/scripts/route.py` (the monorepo is the assumption).

## Shared skills

They live in `.agents/skills/`. A domain playbook reads `../../.agents/skills/<name>/SKILL.md` when it needs one.

| skill | purpose |
|---|---|
| `pdf` / `docx` / `xlsx` / `pptx` | create and read file deliverables |
| `doc-coauthoring` | co-authoring workflow for documents |
| `typesafe-ai` | TypeSafe / Jev design guide (question design, confidence, cascades) |
| `unslop` / `bro` | prose cleanup |
| `skill-creator` | create and improve skills |
| `principle-*` | operating principles (below) |

### principles (pstack-style)

| principle | when it applies |
|---|---|
| `principle-primary-only` | every user-facing turn |
| `principle-laziness-protocol` | before adding a skill / playbook / script |
| `principle-source-primary-sources` | claims about law, tax, medicine, research |
| `principle-facts-over-judgment` | writing analysis, summaries, proposals |
| `principle-calibrated-uncertainty` | using Jev probabilities, writing projections |
| `principle-safety-boundaries-are-hard` | before touching an override, approval gate, or disclosure |
| `principle-prove-it-works` | before declaring done |
| `principle-fix-root-causes` | the same failure appears a second time |
| `principle-guard-the-context-window` | handling large volumes of material |
| `principle-never-block-on-the-human` | before asking the user |
| `principle-encode-lessons-in-structure` | you write the same instruction twice |
| `principle-decision-trail` | long-running or high-risk work |

### agents

| agent | purpose |
|---|---|
| `.agents/agents/worker.md` | delegated research and bulk processing. Returns summaries only |
| `.agents/agents/verifier.md` | read-only independent verification. Reads with intent to break |

When the app does not auto-detect `.agents/agents/`, the primary reads these files and includes them in the subagent prompt.

## Development conventions

Adding a domain:

1. Write the primary contract in `works/<name>/AGENTS.md` (copy an existing domain and swap the expertise).
2. Write the business router in `works/<name>/.agents/routing.json`. Every rule must carry `playbook` and `skills`.
3. Fill `works/<name>/.agents/playbooks/` and `skills/`.
4. Add the domain rule to `.agents/routing.json`.

Adding a business type:

1. Add a rule to `.agents/routing.json` (`id`, `title`, `keywords`, `patterns`, `playbook`, `skills`, `approval`).
2. Write the matching playbook. Split domain knowledge into skills.
3. Every `.agents/skills/<name>/SKILL.md` must carry `name` and `description` in frontmatter (the description is also used for Jev criteria).
4. Pass `python3 .agents/scripts/route.py --selftest`, `decide.py --selftest`, and `jev.py --selftest`.
5. Check the live API with `TYPESAFE_API_KEY` set and `python3 .agents/scripts/jev.py --livetest` (without a key, skip; exit code 2).

Adding a recurring judgment:

1. Add a decision to `.agents/decisions.json` (`type`, `instructions`, `criteria`, `actions`, `policy`).
2. Write criteria whose true/false meaning is concrete. Include examples.
3. Add cases to `decide.py --selftest`.

Rules:

- Safety-side rules (emergency, fraud, deadline, criminal) set `"override": true`. On a match they win regardless of score.
- `approval` is one of `none` / `confirm` / `escalate`. Irreversible actions and expert domains use `escalate`.
- Never write personal data to tracked files. Never remove `works/*/data/` and `.agents/.cache/` from `.gitignore`.
- Keep the Jev cache and usage logs in `.agents/.cache/jev/`. Do not track them.
