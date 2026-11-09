# x-security-rss

X (旧Twitter) からサイバーセキュリティの話題を毎日収集し、一覧ページ・RSS・JSON Feed として配信します。

## 📰 読む・購読する

| 形式                     | URL                                                     | 用途                                                                             |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 🌐 **一覧ページ (HTML)** | **https://oubakiou.github.io/x-security-rss/**          | ブラウザで読む。カテゴリー・日付で絞り込み可                                     |
| 📡 **RSS 2.0**           | **https://oubakiou.github.io/x-security-rss/feed.xml**  | フィードリーダーで購読する                                                       |
| 🧩 **JSON Feed 1.1**     | **https://oubakiou.github.io/x-security-rss/feed.json** | プログラムやエージェントから読む ([仕様](https://www.jsonfeed.org/version/1.1/)) |

内容は Grok による自動収集・自動要約で、投稿者名を含め未検証です。必ず元の投稿と一次情報を確認してください。

## 仕組み

- 収集: xAI Responses API の `x_search` ツール (Grok) — `src/fetch.ts`
  - 対象期間は実行時点から過去24時間。1日2回の実行で期間が重なるが、同じ投稿は最初の収集を保持して重複を除く。x_search の日付指定は厳密でないため、投稿 ID から求めた時刻で期間外を除外
  - 信頼できるアカウント限定の検索と、分野別の一般検索の2本立て
- 保存: 取得結果は1回の実行ごとに `snapshots/YYYY-MM-DD-HH.json` として Pages に置き、日が確定したら
  `archive/YYYY-MM-DD.json` として git にコミット (`src/restore.ts` / `src/build.ts`、詳細は [development.md](development.md))
- 生成: 一覧ページ (`index.html`)、RSS 2.0 (`feed.xml`)、JSON Feed 1.1 (`feed.json`) — `src/build.ts`。RSS と JSON Feed は同じ記事と失敗のお知らせを含む
  - 見出しの先頭に分類の絵文字 (🔓 脆弱性 / 🔥 インシデント / 🕵️ 攻撃キャンペーン / 📝 その他) と CVE 番号を付ける。分類はモデルの判定
  - 投稿者は X の oEmbed (`publish.x.com/oembed`、認証不要) で確認し、モデルが書いた投稿者と違えば X の値に直す。x_search の出典はアカウント名を含まない `/i/status/<id>` 形式のため。確認できなかった記事はモデルの値のまま
  - モデルには各項目の投稿本文の抜粋 (`quote`) も書かせ、oEmbed の本文に含まれるかを照合する (要約と投稿の取り違えの検出)。含まれない記事は、要約がリンク先とは別の投稿について書かれているとみなして `quote_mismatch` として破棄する (ログの `quote check: …` と snapshot に記録)。照合できなかった記事は残す
  - 投稿者が優先アカウント (`TRUSTED_HANDLES`) であることを oEmbed で確認できた記事は、投稿者名の後ろに 🔖 を付ける。RSS / JSON Feed では本文の投稿者の行に 🔖、カテゴリー (tags) に「優先アカウント」、JSON Feed には `_x_security.trusted_author` も付ける。一覧ページは URL の末尾に `#trusted` を付けると優先アカウントの記事だけを表示する
  - 一覧ページはカテゴリーで絞り込める。URL の末尾に `#vulnerability` / `#incident` / `#campaign` / `#other` を付けるとそのカテゴリーだけを表示する (例: [#vulnerability](https://oubakiou.github.io/x-security-rss/#vulnerability))
  - 投稿日 (日本時間) ごとに見出しを付け、上部の棒グラフで日付を選ぶとその日だけを表示する。URL の末尾に `#dYYYY-MM-DD` を付けても同じ (例: [#d2026-11-07](https://oubakiou.github.io/x-security-rss/#d2026-11-07))。カテゴリーと日付の絞り込みは同時には使えない
- 実行: GitHub Actions で毎日 04:17 と 08:17 JST の2回 (`.github/workflows/daily.yml`)。GitHub の定時実行は混雑時に数時間遅れることがある
- 配信: GitHub Pages (URL は冒頭の「読む・購読する」を参照)

## セットアップ

1. **APIキー**: [console.x.ai](https://console.x.ai) でクレジットをチャージし、API キーを発行。
   リポジトリの Settings → Secrets and variables → Actions → **Secrets** に `XAI_API_KEY` として登録。
2. **Pages**: Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定。
3. Actions タブから **Daily X security feed** を `Run workflow` で手動実行して動作確認。
   **初回 (Pages に `manifest.json` が無いとき) だけ `bootstrap` にチェック**を入れて実行します。

任意の設定 (Actions の **Variables**):

| 変数               | 既定値                     | 説明                                              |
| ------------------ | -------------------------- | ------------------------------------------------- |
| `XAI_MODEL`        | `grok-build-0.1`           | 使用モデル                                        |
| `MAX_ITEMS`        | `15`                       | 一般検索の最大件数 (アカウント限定検索はその半分) |
| `MAX_TURNS`        | `3`                        | 検索1本あたりの往復回数の上限 (費用の上限に効く)  |
| `TRUSTED_HANDLES`  | `src/lib/config.ts` の一覧 | 優先検索するアカウント (カンマ区切り、最大20)     |
| `EXCLUDED_HANDLES` | なし                       | 除外するアカウント (カンマ区切り、最大20)         |
| `WINDOW_HOURS`     | `24`                       | 対象期間 (時間、1〜72)                            |

`TRUSTED_HANDLES` を設定しない場合は、[`src/lib/config.ts`](src/lib/config.ts) の `DEFAULT_TRUSTED_HANDLES` にあるアカウントを優先検索します。
変数を設定すると、この一覧を置き換えます (追加ではありません)。自分の環境で一覧を変えたいときは、フォークしたリポジトリで変数を設定するか、`DEFAULT_TRUSTED_HANDLES` を書き換えてください。

`EXCLUDED_HANDLES` に指定したアカウントの投稿は掲載しません。既定の一覧はなく、変数でだけ指定します。
一般検索の X 検索ツールで除外したうえで、両方の検索結果から、投稿者がこれらのアカウントである投稿を破棄します (ログと snapshot には `excluded_handle` として記録)。
`TRUSTED_HANDLES` と重なるアカウントは、優先検索の対象からも外します。

`XAI_MODEL` に指定したモデルの特徴 (2026-11 時点で試した範囲。1回は検索2本、既定の件数で実行した場合):

| モデル           | 1回の費用の目安 | 特徴                                                                                                                                   |
| ---------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `grok-build-0.1` | 約 $0.4         | 既定。検索回数が多く採用件数も多い。要約は CVE・CVSS・影響・対処を簡潔にまとめる。一般検索はプロンプトで検索回数を絞っている           |
| `grok-4.3`       | 約 $0.3         | 最も安い。文章はやや自然だが、要約に出典の評価 (「一次情報に基づく」など) が混ざることがある。採用件数は少なめで回によるばらつきがある |
| `grok-4.5`       | -               | そのままでは x_search を呼ばず、毎回0件で失敗する。検索を強制すると動くが、費用は grok-4.3 の約6倍                                     |
| `grok-4.6`       | -               | そのままでは x_search を呼ばない。検索を強制すると最終回答の前に応答が終わる                                                           |

費用の大半は X 検索で取得した投稿数 ($5 / 1,000件) で、モデルのトークン単価より検索回数の差が効きます。
モデルを変えたら、Actions のログの `usage=` (`x_search_calls`、`x_posts_fetched`、`cost_in_usd_ticks`) で確認してください。
検証の詳細は [development.md](development.md) の「モデルの変更」にあります。

## 失敗したとき

X 検索ツールの呼び出しがすべて失敗した検索は、xAI 側の一時的な障害とみなして最大2回やり直します。それでも収集に失敗すると次のようになります。

- フィードの先頭に「⚠️」で始まる記事が出る。見出しと本文は原因の種類 (API キー、クレジット、X 検索ツールの障害など) に応じた固定の説明で、xAI のエラー文は含めない。詳しい内容は Actions の実行ログにある
- ワークフローが失敗扱いになり、GitHub から通知メールが届く

## 開発

規約・検証手順・レビュー観点は [development.md](development.md) を参照してください。
