# x-security-rss

X (旧Twitter) からサイバーセキュリティの話題を毎日収集し、RSS として配信します。

- 収集: xAI Responses API の `x_search` ツール (Grok) — `src/fetch.ts`
  - 対象期間は実行時点から過去24時間。1日2回の実行で期間が重なるが、同じ投稿は最初の収集を保持して重複を除く。x_search の日付指定は厳密でないため、投稿 ID から求めた時刻で期間外を除外
  - 信頼できるアカウント限定の検索と、分野別の一般検索の2本立て
- 保存: 取得結果は1回の実行ごとに `snapshots/YYYY-MM-DD-HH.json` として Pages に置き、日が確定したら
  `archive/YYYY-MM-DD.json` として git にコミット (`src/restore.ts` / `src/build.ts`、詳細は [development.md](development.md))
- 生成: RSS 2.0 (`feed.xml`) と一覧ページ (`index.html`) — `src/build.ts`
  - 見出しの先頭に分類の絵文字 (🔓 脆弱性 / 🔥 インシデント / 🕵️ 攻撃キャンペーン / 📝 その他) と CVE 番号を付ける。分類はモデルの判定
- 実行: GitHub Actions で毎日 04:17 と 08:17 JST の2回 (`.github/workflows/daily.yml`)。GitHub の定時実行は混雑時に数時間遅れることがある
- 配信: GitHub Pages — RSS: **https://oubakiou.github.io/x-security-rss/feed.xml** / HTML: **https://oubakiou.github.io/x-security-rss/**

## セットアップ

1. **APIキー**: [console.x.ai](https://console.x.ai) でクレジットをチャージし、API キーを発行。
   リポジトリの Settings → Secrets and variables → Actions → **Secrets** に `XAI_API_KEY` として登録。
2. **Pages**: Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定。
3. Actions タブから **Daily X security feed** を `Run workflow` で手動実行して動作確認。
   **初回 (Pages に `manifest.json` が無いとき) だけ `bootstrap` にチェック**を入れて実行します。

任意の設定 (Actions の **Variables**):

| 変数              | 既定値                     | 説明                                              |
| ----------------- | -------------------------- | ------------------------------------------------- |
| `XAI_MODEL`       | `grok-4.3`                 | 使用モデル                                        |
| `MAX_ITEMS`       | `15`                       | 一般検索の最大件数 (アカウント限定検索はその半分) |
| `MAX_TURNS`       | `6`                        | 検索1本あたりの往復回数の上限 (費用の上限に効く)  |
| `TRUSTED_HANDLES` | `src/lib/config.ts` の一覧 | 優先検索するアカウント (カンマ区切り、最大20)     |
| `WINDOW_HOURS`    | `24`                       | 対象期間 (時間、1〜72)                            |

`TRUSTED_HANDLES` を設定しない場合は、[`src/lib/config.ts`](src/lib/config.ts) の `DEFAULT_TRUSTED_HANDLES` にあるアカウントを優先検索します。
変数を設定すると、この一覧を置き換えます (追加ではありません)。自分の環境で一覧を変えたいときは、フォークしたリポジトリで変数を設定するか、`DEFAULT_TRUSTED_HANDLES` を書き換えてください。

## 失敗したとき

収集に失敗すると次のようになります。

- フィードの先頭に「⚠️」で始まる記事が出る。見出しと本文は原因の種類 (API キー、クレジット、X 検索ツールの障害など) に応じた固定の説明で、xAI のエラー文は含めない。詳しい内容は Actions の実行ログにある
- ワークフローが失敗扱いになり、GitHub から通知メールが届く

## 開発

規約・検証手順・レビュー観点は [development.md](development.md) を参照してください。
