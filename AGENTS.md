# cowork

個人生活をエージェントに任せるためのモノレポ。Claude Cowork / GPT work の思想を、専門領域ごとの独立した agent distro に分割して実装する。

ユーザーが対話するのは常に primary agent 一人だけ。意思決定はすべて TypeSafe Jev (`jev-latest`) の型付き分類で行い、確率と確信度で行動を変える。Jev が使えないときは決定論的ルーターが同じ判定を返す。

## レイアウト

```
AGENTS.md                      このファイル。モノレポ全体の契約
.opencode/plugins/
  answer-guard.js              回答 hooks。Jev で出力を検品し、過剰ブロックを削る
.agents/
  scripts/jev.py               Jev クライアント (キャッシュ、伏字化、リトライ、検証)
  scripts/guard.py             回答ガード (answered/over_answer/ai_speak とブロック選別)
  scripts/route.py             Jev-first ルーター (1 コールで playbook/skills/agent/format を判定)
  scripts/decide.py            実行中の意思決定カタログ (escalate, grounded, delegate など)
  decisions.json               意思決定カタログ (Jev の質問定義とオフライン policy)
  routing.json                 領域ルーターの分類データ
  agents/worker.md             委任ワーカー (pstack の agent 構成)
  agents/verifier.md           読み取り専用の独立検証者
  skills/                      汎用 skills (公式 skill のコピーを優先)
    typesafe-ai/               TypeSafe 公式 skill
    principle-*/               pstack 式の行動原則 (12 種)
works/
  finance/AGENTS.md            金融・資産管理の primary agent 契約
  finance/.agents/
    routing.json               業務ルーターの分類データ
    playbooks/*.md             業務フロー (ルーティング先)
    skills/*/SKILL.md          専門知識モジュール
  legal/                       法律・契約 (同じ構成)
  medical/                     医療・健康 (同じ構成)
  ml-research/                 ML研究 (同じ構成)
```

各 `works/<domain>/` は `.git` を持たないが、独立したリポジトリとして開発する前提で自己完結させる。汎用 skills だけは `.agents/skills/` に置き、領域からは相対パス `../../.agents/skills/` で読む。

## primary-only 原則

1. ユーザーと対話するのは primary agent だけ。サブエージェントはユーザーに直接話しかけない。ユーザーに「別のエージェントに聞いて」と言わない。
2. 意思決定は毎ターン最初に `route.py`、作業中は `decide.py` を実行して決める。推測で playbook を選ばない。
3. ルーターの `decision` に従う。
   - `override`: 安全上の上書き。playbook に直ちに従い、`escalation` を提示する。
   - `route`: `playbook` と `skills` を読み、`agents` の指示に従って委任し、`format` に従って成果物を作る。
   - `clarify`: `clarify_questions` をユーザーに聞く。作業を始めない。
4. primary agent の作業範囲は調査・分析・計画・文書ドラフトまで。契約締結、送金、売買執行、投稿など不可逆な実行はユーザー本人が行う。
5. 個人データ (資産額、契約内容、症状、研究データ) は `works/<domain>/data/` にだけ書く。`.agents/` や routing.json などの追跡対象ファイルには絶対に書かない。Jev へ送る state は `route.py` / `decide.py` が自動で伏字化する。

## 回答規範

1. 聞かれたことにだけ答える。背景・先回り・代替案・次のステップ・まとめを足さない。分からないことはユーザーが聞き返す。
2. 一度に全部説明しない。単純な質問は 1〜3 文、手順や比較が必要なときだけ箇条書き。
3. 前置き・復唱・免責・「いかがでしょうか」を書かない。`unslop` skill に従う。
4. 完了報告は「やったこと・検証結果・気づき」だけ。
5. 240 文字以上の回答は `.opencode/plugins/answer-guard.js` が `text.complete` で Jev 検品し、過剰ブロックを削る。判定ログは `.agents/.cache/guard/log.jsonl`。過剰判定のあとは次ターンの system prompt に注意が入る。`TYPESAFE_API_KEY` 未設定時は何もしない。

## 意思決定アーキテクチャ

すべての実行時判断は Jev の 3 プリミティブ (noul / choice / score) に落ちる。1 リクエストで並列に評価し、70〜500ms で返る。

### 1. ターン開始: `route.py`

```sh
printf '%s' "$PROMPT" | python3 .agents/scripts/route.py --routing .agents/routing.json --json
```

1 コールで次を同時に判定する。

| 質問 | 型 | 用途 |
|---|---|---|
| `safety` | choice | 安全上の override (詐欺、救急、期限、刑事) の検出 |
| `playbook` | choice | 業務フローの選択 |
| `skill:*` | noul | 各専門知識モジュールを読むべきか |
| `clarify` | noul | 前提不足でユーザー確認が必要か |
| `delegate` | noul | サブエージェントに委任すべきか |
| `verify` | noul | 独立検証が必要か |
| `format` | choice | 成果物の形式 (xlsx / docx / pdf / pptx) |

### 2. 作業中: `decide.py`

```sh
printf '%s' "$DRAFT" | python3 .agents/scripts/decide.py grounded cites_sources safety_disclosure
python3 .agents/scripts/decide.py delegate --state "対象論文が200本ある"
```

カタログは `.agents/decisions.json`。`--list` で一覧。Jev が使えない場合は `"source": "unavailable"` と policy が返るので、その policy に従う。

### 3. 確信度バンド

| 確信度 | 行動 |
|---|---|
| ≥ 0.80 | act。そのまま進める |
| 0.55 - 0.80 | confirm。前提を確認してから進める |
| < 0.55 | clarify。質問するか複数案を出す |

安全の override は 0.35 で発火する。しきい値は `route.py` / `decisions.json` に集約し、領域データで較正したら理由を記録して変更する。

### 4. オフライン

`TYPESAFE_API_KEY` が未設定、または Jev がエラー・タイムアウトのときは、`route.py` は keyword ルーターにフォールバックし `meta.source: "keyword"` を返す。`decide.py` は policy を返す。API キーは環境変数のみ。ファイルに書かない。

### 5. カタログにない判断

`decisions.json` にない実行時判断 (どの skill を先に読むか、この下書きは送ってよいか等) は `jev.py` に直接聞く。1 コールに複数の質問を入れてよい。

```sh
printf '%s' '{"state": "…", "questions": {"next_step": {"type": "choice", "instructions": "…", "criteria": {"a": "…", "b": "…"}}}}' | python3 .agents/scripts/jev.py --scrub
```

## セッションの始め方

モノレポのルートで受けた依頼:

```sh
printf '%s' "$PROMPT" | python3 .agents/scripts/route.py --routing .agents/routing.json --json
```

出力の `root` が担当領域。`works/<domain>/AGENTS.md` を読み、その契約に従う。領域内でさらに:

```sh
printf '%s' "$PROMPT" | python3 ../../.agents/scripts/route.py --routing .agents/routing.json --json
```

領域フォルダを単体で開いた場合は、そのフォルダの `AGENTS.md` が起点になる。ルーターの実体は `../../.agents/scripts/route.py` を参照する (モノレポ前提)。

## 汎用 skills

`.agents/skills/` にある。領域の playbook が必要に応じて `../../.agents/skills/<name>/SKILL.md` を読む。

| skill | 用途 |
|---|---|
| `pdf` / `docx` / `xlsx` / `pptx` | ファイル成果物の作成・読み取り |
| `doc-coauthoring` | 文書の共同執筆ワークフロー |
| `typesafe-ai` | TypeSafe / Jev の設計ガイド (質問設計、確信度、カスケード) |
| `unslop` / `bro` | 文章の整形 |
| `skill-creator` | skill の新規作成・改善 |
| `principle-*` | 行動原則 (下記) |

### principles (pstack 式)

| principle | 適用場面 |
|---|---|
| `principle-primary-only` | すべてのユーザー対応 |
| `principle-laziness-protocol` | 新しい skill / playbook / script を足す前 |
| `principle-source-primary-sources` | 法令・税制・医療・研究の主張 |
| `principle-facts-over-judgment` | 分析・要約・提案を書くとき |
| `principle-calibrated-uncertainty` | Jev の確率を使うとき、予測を書くとき |
| `principle-safety-boundaries-are-hard` | override、承認ゲート、開示を触る前 |
| `principle-prove-it-works` | 完了宣言の前 |
| `principle-fix-root-causes` | 同じ失敗が 2 回目 |
| `principle-guard-the-context-window` | 大量の資料を扱うとき |
| `principle-never-block-on-the-human` | ユーザーに聞く前に |
| `principle-encode-lessons-in-structure` | 同じ指示を 2 回書いたとき |
| `principle-decision-trail` | 長時間・高リスクの作業 |

### agents

| agent | 用途 |
|---|---|
| `.agents/agents/worker.md` | 委任された調査・大量処理。要約だけを返す |
| `.agents/agents/verifier.md` | 読み取り専用の独立検証。壊すつもりで読む |

アプリが `.agents/agents/` を自動検出しない場合は、primary がこのファイルを読んでサブエージェントのプロンプトに含める。

## 開発規約

新しい領域を足すとき:

1. `works/<name>/AGENTS.md` に primary 契約を書く (既存領域をコピーして専門性を差し替える)。
2. `works/<name>/.agents/routing.json` に業務ルーターを書く。各 rule に `playbook` と `skills` を必ず持たせる。
3. `works/<name>/.agents/playbooks/` と `skills/` を埋める。
4. `.agents/routing.json` に領域 rule を追加する。

新しい業務種別を足すとき:

1. `.agents/routing.json` に rule を追加する (`id`, `title`, `keywords`, `patterns`, `playbook`, `skills`, `approval`)。
2. 対応する playbook を書く。必要な専門知識は skill に分離する。
3. `.agents/skills/<name>/SKILL.md` は frontmatter の `name` と `description` を必ず書く (description が Jev の criteria にも使われる)。
4. `python3 .agents/scripts/route.py --selftest`、`decide.py --selftest`、`jev.py --selftest` を通す。
5. 実 API の疎通は `TYPESAFE_API_KEY` を設定して `python3 .agents/scripts/jev.py --livetest` で確認する (鍵が無ければ skip、終了コード 2)。

繰り返す判断を足すとき:

1. `.agents/decisions.json` に decision を追加する (`type`, `instructions`, `criteria`, `actions`, `policy`)。
2. criteria は true/false の意味が具体的に分かる文で書く。例を入れる。
3. `decide.py --selftest` にケースを追加する。

ルール:

- 安全側の rule (緊急、詐欺、期限、刑事) は `"override": true` にする。スコアに関係なく一致したら勝つ。
- `approval` は `none` / `confirm` / `escalate` のいずれか。不可逆操作や専門家領域は `escalate`。
- 個人データを追跡ファイルに書かない。`.gitignore` の `works/*/data/` と `.agents/.cache/` を外さない。
- Jev のキャッシュと利用ログは `.agents/.cache/jev/` に置く。追跡しない。
