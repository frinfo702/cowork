---
name: principle-decision-trail
description: "Apply to long, autonomous, or high-stakes work, and whenever a JEV decision changed the course. Keep a reviewable record of decisions, confidences, and sources."
disable-model-invocation: true
---

# Decision Trail

後から検証できるように、判断の記録を残す。

## 記録するもの

- ルーターの出力 (`route.py --json` の decision、route、skills、confidence)
- 途中のゲート (`decide.py` の answer、confidence、source)。`data/decisions.jsonl` に自動記録される
- 採用しなかった選択肢と、その理由
- 使った一次情報と確認日

## ルール

- **判断は JEV の出力ごと残す。** 要約だけだと、失敗したときどの分類が間違ったか特定できない。
- **personal data を記録に含めない。** 状態はハッシュと短い要約まで。本文は `data/` の元資料を参照する。
- **ユーザーに見せる形にする。** 長時間の作業や放置される作業では、最後に「決定と根拠」の一覧を出す。`principle-prove-it-works` の検証結果もここに含める。
- **キャッシュを汚さない。** 記録とキャッシュは `.agents/.cache/jev/` (非追跡) に分離する。

## テスト

この回答の結論を、第三者がログとソースだけで再現できるか。
