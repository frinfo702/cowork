---
name: principle-calibrated-uncertainty
description: "Apply whenever Jev returns probabilities or confidence, and whenever writing projections, diagnoses, or predictions. Act on high confidence, confirm the middle band, clarify or escalate the low band; never fake certainty."
disable-model-invocation: true
---

# Calibrated Uncertainty

Jev の確率は「当たる度合い」の見積もりであり、飾りではない。バンドで行動を変える。

## 確信度バンド (既定)

| 確信度 | 行動 |
|---|---|
| ≥ 0.80 | act。そのまま進める |
| 0.55 - 0.80 | confirm。前提を確認してから進める |
| < 0.55 | clarify。決め打ちせず、質問するか複数案を出す |

安全に関わる判断 (詐欺、救急、期限、刑事) はしきい値を下げる。`route.py` の override は 0.35 で発火する。迷ったら安全側に倒す。

## ルール

- **確率を無視しない。** 低確信の分類で断定した回答を送らない。確信度は回答の meta に残す。
- **しきい値を調整したら記録する。** ドメインのデータで較正するまで、既定値を使い、変えた理由を残す。
- **数値の不確実性も同じ。** 予測は幅で示す。「65 歳で 3,241 万円」ではなく「2,800〜3,600 万円 (前提: 実質 2〜3% で運用、インフレ 1%)」。
- **noul の 0.5 は「中間」ではない。** 賛否が半々という意味。0.5 付近は判断を保留して追加情報を集める。
- **使わない分岐の不確実性は無視してよい。** 全事実に修飾語を付けない。

## テスト

回答の各断定に、それを支える確信度か出典があるか。なければ断定を弱める。
