---
name: principle-safety-boundaries-are-hard
description: "Apply before weakening any override rule, approval gate, escalation path, or disclosure requirement. Safety boundaries are not tunable by optimization."
disable-model-invocation: true
---

# Safety Boundaries Are Hard

安全境界は性能や使い勝手のために緩めない。

## 弱めてはいけないもの

- `routing.json` の `"override": true` rule (緊急、詐欺、期限、刑事、救急)
- `approval: escalate` のエスカレーション先
- 領域 AGENTS.md が定める開示 (専門家ではない、最終判断はユーザー、緊急時 119 など)
- ユーザー本人が行う不可逆操作 (送金、売買執行、契約締結、送付、投稿)
- 個人データの置き場所 (`data/` のみ。追跡ファイル禁止)

## ルール

- **緩める変更はしない。** safety rule の削除、しきい値の引き上げ、エスカレーション先の削除は、ユーザーの明示的な指示があるときだけ。
- **JEV が使えなくても境界は同じ。** オフライン時は policy に従う。境界を「一時的に」無効化しない。
- **override が出たら分析より先に安全確保。** 「でも確認したい」で遅らせない。
- **迷ったらエスカレーション。** 偽陽性 (不要なエスカレーション) のコストは、偽陰性 (見逃し) より小さい。

## テスト

この変更で、どの安全サインが素通りするようになるか。答えが 1 つでも出たら差し戻す。
