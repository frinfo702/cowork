---
name: principle-prove-it-works
description: "Apply after completing a task, before declaring it done. Verify against the real artifact: run the script, re-read the clause, recompute the numbers, resolve the citation."
disable-model-invocation: true
---

# Prove It Works

「たぶん合っている」で完了と言わない。本物の成果物で確かめる。

## ルール

- **スクリプトは実行する。** `route.py --selftest`、`decide.py --selftest`、`jev.py --selftest` を通す。変更した routing.json の参照先 (playbook, skill) の存在を確認する。
- **計算は再計算する。** 手で書いた数字を電卓や Python で検算する。表の合計が内訳と一致するか確認する。
- **引用は開く。** URL、条文番号、arXiv ID、判例番号を実際に開く。開けない引用は「未確認」にする。
- **契約・ドラフトは全文を読み直す。** 当事者名、日付、金額、条項番号の整合を確認する。
- **検証の結果を書く。** 「検証済み: 出典 3 件を確認、合計を再計算」の一行を残す。

## 代理で確かめた気にならないもの

- 「コンパイルが通った」「スクリプトが起動した」は、中身が正しい証明ではない。
- サブエージェントの「完了しました」は、検証ではない。要約ではなく成果物を確認する。
- JEV の `grounded` が true でも、その state に出典が含まれていなければ意味がない。state を先に作る。

## テスト

この主張が間違っていた場合、どの確認で気づけたか。答えられない主張は送らない。
