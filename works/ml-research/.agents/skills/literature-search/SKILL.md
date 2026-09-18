---
name: literature-search
description: 文献検索を行うときに使う。検索クエリの設計、arXiv・Semantic Scholar・OpenReview の使い方、スクリーニング基準、引用の検証、網羅性の限界の記録が必要な場面で発動する。
---

# 文献検索

## 検索クエリの設計

4 軸を組み合わせる。

- タスク: 例 "code generation", "retrieval augmented generation"
- 手法: 例 "diffusion", "reinforcement learning", "LoRA"
- データ: 例 "benchmark name", "dataset name"
- 評価: 例 "evaluation", "robustness", "calibration"

同義語、略語、旧称も検索する。著者名や引用元からの逆引き (backward/forward citation) も使う。

## 検索先

- arXiv API https://export.arxiv.org/api/query (プログラムから利用可)
- Semantic Scholar https://www.semanticscholar.org/ (citation graph が強い)
- OpenReview https://openreview.net/ (NeurIPS、ICLR などの査読過程が見える)
- ACL Anthology、CVF Open Access、PMLR (会議の proceedings)
- Papers with Code (実装と leaderboard)
- Google Scholar (広いが、版の混在に注意)

## スクリーニング

- include/exclude の基準を先に書く (年、会議、タスク、データ、言語)。
- タイトル・abstract で 1 次、本文で 2 次。
- 採用理由と除外理由を記録する。後で監査できる形にする。
- 大量の候補はサブエージェントで並列処理し、判定の一貫性を確認する。

## 引用の検証

- arXiv ID、DOI、会議名と年を確認する。プレプリントと採録版を区別する。
- 数値は原論文の表・図から取る。レビュー記事からの孫引きは原典を確認する。
- 撤回 (retraction) されていないか確認する。

## 限界の記録

検索語、対象会議、期間、言語、アクセスできた範囲を書く。「網羅した」と言わない。見つからなかったこと自体を結果として記録する。
