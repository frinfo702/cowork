---
name: principle-encode-lessons-in-structure
description: "Apply when you catch yourself writing the same instruction, caveat, or correction a second time. Encode it as a routing rule, keyword, pattern, skill, decision, or selftest instead of more prose."
disable-model-invocation: true
---

# Encode Lessons in Structure

同じ注意を 2 回書いたら、それは文章ではなく構造の仕事。

## 変換先

| 繰り返していること | 置き場所 |
|---|---|
| 特定の言い回しを取りこぼす | `routing.json` の keyword / pattern + selftest |
| 判定基準の説明 | `routing.json` の `notes` / `criteria` |
| 毎回同じ手順を指示している | playbook |
| 毎回同じ知識を説明している | skill |
| 毎回同じ gate を口頭で確認している | `decisions.json` の decision |
| 毎回同じ前提確認をしている | `clarify_questions` |

## ルール

- **プロンプトに足す前に構造に足す。** AGENTS.md に一文を足すのは最後。まず rule、skill、decision、テストのどこかに置けないか考える。
- **JEV の criteria を具体的に書く。** 「該当するか」ではなく、true/false の意味を例で書く。分類の質は criteria の質で決まる。
- **テストを添える。** 構造を足したら `--selftest` に再現ケースを追加する。テストのない rule は腐る。
- **重複を消す。** 同じことを routing.json と AGENTS.md に二重に書いたら、片方を削る。

## テスト

次に同じ状況が来たとき、エージェントが同じ指示を読まなくても正しく動くか。
