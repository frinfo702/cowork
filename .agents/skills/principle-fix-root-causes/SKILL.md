---
name: principle-fix-root-causes
description: "Apply when a mistake repeats or a routing miss, bad answer, or gate failure shows up a second time. Fix the shared rule, taxonomy, or skill, not the single answer."
disable-model-invocation: true
---

# Fix Root Causes

症状を一度だけ直して終わらない。同じ失敗が再発するなら、原因は共有部分にある。

## ルール

- **ルーティングのミスは routing.json を直す。** 言い換え (「NISAとiDeCoの枠」) を 1 回拾えなかったら、keyword か pattern を足して `--selftest` に例を追加する。回答を場当たりで補正しない。
- **専門知識の不足は skill を直す。** 毎回同じ注意をプロンプトで補っているなら、それは skill に書くべき内容。
- **安全の失敗は最優先で直す。** override をすり抜けたら、rule と pattern を足し、テストを追加する。
- **一度で原因まで届かないときは、なぜを繰り返す。** 表面的な修正 (個別の言い換えを 1 つ足す) を重ねるより、分類軸そのものを見直す。
- **直した証拠を残す。** `--selftest` に再現ケースを追加し、`data/` か commit message に理由を書く。

## テスト

同じ指摘が 2 回目なら、それは個人のミスではなく構造のミス。構造を直したか。
