---
name: principle-laziness-protocol
description: "Apply when tempted to add a skill, playbook, script, or tool for a need that existing ones can cover. Bias toward the smallest artifact and the fewest moving parts."
disable-model-invocation: true
---

# Laziness Protocol

もっとも少ない道具で、もっとも確実な成果を出す。

## ルール

- **既存を先に探す。** 新しい skill や playbook を書く前に、既存の routing rule、playbook、skill、公式 skill (Anthropic / OpenAI / TypeSafe / pstack) で足りないか確認する。
- **削除を優先する。** 改善を求められたら、追加より削除を先に探す。使われていない rule、重複した keyword、読まれない節を消す。
- **判断は一箇所に。** 同じ分類を skill と routing.json の両方に書かない。ルーティングは routing.json、専門知識は skill に一箇所だけ。
- **差分を最小にする。** 依頼を満たす最小の変更をする。将来のための抽象化、使われないパラメータ、まだ必要でない設定を足さない。
- **skill を増やすのは最後の手段。** 公式の同等物がなければ自作する。自作したら `skill-creator` の形式に従う。

## テスト

この追加を消したら、どの依頼が失敗するか。答えられないなら足さない。
