---
name: principle-guard-the-context-window
description: "Apply when a task pulls in large documents, long logs, many papers, or repeated reads. Route bulk to a worker subagent and keep summaries in the primary thread."
disable-model-invocation: true
---

# Guard the Context Window

会話の文脈は有限。大量の生データを primary に持ち込まない。

## ルール

- **委任は JEV に決めさせる。** `route.py` の `delegate` シグナルが true なら `.agents/agents/worker.md` の契約でサブエージェントを起動する。
- **戻すのは要約と検証済みの数値だけ。** 生のログ、全文、明細をそのまま会話に貼らない。
- **ファイルで渡す。** 長い資料は `data/` に置き、パスと要点だけを共有する。
- **読む順序を決める。** 全部読む前に、目次・abstract・結論で当たりを付ける。必要な部分だけ精読する。
- **JEV に渡す state も削る。** 分類に不要な文脈は精度を下げる。質問に関係する抜粋だけを渡す (retrieve, then judge)。

## テスト

primary のコンテキストに入った生データの量は、回答に必要な量の何倍か。3 倍を超えるなら委任を検討する。
