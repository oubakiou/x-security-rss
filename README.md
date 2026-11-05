# x-security-rss

X (旧Twitter) からサイバーセキュリティの話題を毎日収集し、RSS として配信します。

- 収集: xAI Responses API の `x_search` ツール (Grok) — `src/fetch.ts`
  - 対象期間は実行時点から過去24時間。1日2回の実行で期間が重なるが、同じ投稿は最初の収集を保持して重複を除く。x_search の日付指定は厳密でないため、投稿 ID から求めた時刻で期間外を除外
  - 信頼できるアカウント限定の検索と、分野別の一般検索の2本立て
- 保存: 取得結果は1回の実行ごとに `snapshots/YYYY-MM-DD-HH.json` として Pages に置き、日が確定したら
  `archive/YYYY-MM-DD.json` として git にコミット (`src/restore.ts` / `src/build.ts`、詳細は [development.md](development.md))
- 生成: RSS 2.0 (`feed.xml`) と一覧ページ (`index.html`) — `src/build.ts`
- 実行: GitHub Actions で毎日 04:17 と 10:17 JST の2回 (`.github/workflows/daily.yml`)。GitHub の定時実行は混雑時に数時間遅れることがある
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

`TRUSTED_HANDLES` を設定しない場合は、次のアカウントを優先検索します (`src/lib/config.ts` の `DEFAULT_TRUSTED_HANDLES`)。
変数を設定すると、この一覧を置き換えます (追加ではありません)。自分の環境で一覧を変えたいときは、フォークしたリポジトリで変数を設定するか、`DEFAULT_TRUSTED_HANDLES` を書き換えてください。

- [@CISACyber](https://x.com/CISACyber)
- [@jpcert](https://x.com/jpcert)
- [@MsftSecIntel](https://x.com/MsftSecIntel)
- [@Mandiant](https://x.com/Mandiant)
- [@Unit42_Intel](https://x.com/Unit42_Intel)
- [@BleepinComputer](https://x.com/BleepinComputer)
- [@TheHackersNews](https://x.com/TheHackersNews)
- [@SecurityWeek](https://x.com/SecurityWeek)
- [@DarkReading](https://x.com/DarkReading)
- [@piyokango](https://x.com/piyokango)
- [@cyber_forecast](https://x.com/cyber_forecast)
- [@yousukezan](https://x.com/yousukezan)

## 失敗したとき

収集に失敗すると次のようになります。

- フィードの先頭に「⚠️ 収集に失敗しました」記事が出る (エラー内容つき)
- ワークフローが失敗扱いになり、GitHub から通知メールが届く

よくある原因: API キーの失効 (`HTTP 400/401`) → キーを再発行して Secret を更新。
クレジット切れ (`HTTP 402/429`) → console.x.ai でチャージ。

## セキュリティ上の設計

- 取得結果 (LLM 出力・X の投稿内容) は信頼しない入力として扱う
  - 投稿 URL は厳密に解析し、API が出典 (`citations` / `annotations`) として返した投稿 ID だけを採用 (0件なら全件破棄)
  - リンクは `https://x.com/i/status/<id>` に組み直す (X が実際の投稿者に転送する)。投稿者名はモデルの出力で未検証のため、記事ごとではなくサイトとフィードの説明文で一括して示す
  - 投稿時刻は投稿 ID (snowflake) から算出。件数・文字数に上限、XML で不正な文字・双方向制御文字を除去
  - RSS/HTML は全項目をエスケープ。index.html は CSP でスクリプトを禁止
- 公開する失敗メッセージは HTTP ステータスと固定の説明のみ。詳細は Actions ログ (ワークフローコマンドを無害化して出力)
- ワークフローは既定で権限なし。収集ジョブは読み取りのみ、確定ジョブは `contents: write` で git 操作だけを行い、公開ジョブは `pages`/`id-token` のみ。checkout は認証情報を残さず、push 時だけトークンを渡す
- Pages の復元はハッシュで照合し、失敗・不一致・前回より欠けた状態では公開しない
- Action はコミット SHA で固定し、Dependabot (7日クールダウン) で更新

## 開発

規約・検証手順・レビュー観点は [development.md](development.md) を参照してください。
