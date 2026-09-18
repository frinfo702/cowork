# playbook: paper-writing — 論文の執筆

## 目的

主張、証拠、限界の対応が取れた原稿を作る。査読者の立場で自己レビューしてから出す。

## 手順

1. 投稿先と締切を確認する (`approval: confirm`)。ページ制限、テンプレート、匿名化、付録の扱い、LLM 利用ポリシー。
2. 中心主張を一文で書く。contribution list を 2〜4 個に絞る。
3. 構成を組む (`skills/research-writing`)。
   - abstract: 問題、手法、結果、含意
   - introduction: 問題設定、なぜ難しいか、貢献
   - related work: 差分が明確になる形
   - method: 再現できる粒度
   - experiments: 設定、結果、ablation
   - limitation: 正直に
4. 各主張に証拠を紐付ける。証拠のない主張を削るか、主張を弱める。
5. 図表を先に作る。図 1 枚で伝わる構造にする。軸、凡例、キャプションを自己完結にする。
6. 数字を原稿に書く前に実験ログと照合する。丸めを統一する。
7. 査読者の立場で自己レビューする。想定反論を列挙し、原稿で答える。埋められない穴は limitation に書く。
8. 再現性情報を添える (`skills/reproducibility-checklist`): コード、seed、ハイパーパラメータ、計算資源、データ版。
9. `docx` または LaTeX で整形する。`unslop` を適用する。冗長な表現、過大な主張、曖昧な形容詞を削る。

## 使う skills

- `skills/research-writing`
- `skills/research-ethics`
- `skills/reproducibility-checklist`

## 出力

- セクションごとの草稿
- 図表とキャプション
- contribution list と主張・証拠対応表
- 再現性チェックリストの記入
- 想定反論と回答

## 承認・エスカレーション

`approval: confirm`。投稿はユーザーが行う。著者順、謝辞、利益相反、LLM 利用の開示はユーザーが確認する。
