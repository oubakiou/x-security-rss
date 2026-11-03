# x-security-rss

X (旧Twitter) からサイバーセキュリティの話題を毎日収集し、RSS として配信します。

- 収集: xAI Responses API の `x_search` ツール (Grok) — `src/fetch.ts`
  - 対象期間は実行時点から過去24時間 (毎日 9:00 JST 実行なので前日9時〜当日9時)。x_search の日付指定は厳密でないため、投稿 ID から求めた時刻で期間外を除外
  - 信頼できるアカウント限定の検索と、分野別の一般検索の2本立て
- 保存: 取得結果は1回の実行ごとに `snapshots/YYYY-MM-DD-HH.json` として Pages に置き、日が確定したら
  `archive/YYYY-MM-DD.json` として git にコミット (`src/restore.ts` / `src/build.ts`、詳細は [development.md](development.md))
- 生成: RSS 2.0 (`feed.xml`) と一覧ページ (`index.html`) — `src/build.ts`
- 実行: GitHub Actions で毎日 09:00 JST (`.github/workflows/daily.yml`)
- 配信: GitHub Pages — **https://oubakiou.github.io/x-security-rss/feed.xml**

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

## 失敗したとき

収集に失敗すると次のようになります。

- フィードの先頭に「⚠️ 収集に失敗しました」記事が出る (エラー内容つき)
- ワークフローが失敗扱いになり、GitHub から通知メールが届く

よくある原因: API キーの失効 (`HTTP 400/401`) → キーを再発行して Secret を更新。
クレジット切れ (`HTTP 402/429`) → console.x.ai でチャージ。

## セキュリティ上の設計

- 取得結果 (LLM 出力・X の投稿内容) は信頼しない入力として扱う
  - 投稿 URL は厳密に解析し、API が出典 (`citations` / `annotations`) として返した投稿 ID だけを採用 (0件なら全件破棄)
  - リンクは `https://x.com/i/status/<id>` に組み直す (X が実際の投稿者に転送する)。出典で投稿者を確認できない場合は「※投稿者未検証」と表示
  - 投稿時刻は投稿 ID (snowflake) から算出。件数・文字数に上限、XML で不正な文字・双方向制御文字を除去
  - RSS/HTML は全項目をエスケープ。index.html は CSP でスクリプトを禁止
- 公開する失敗メッセージは HTTP ステータスと固定の説明のみ。詳細は Actions ログ (ワークフローコマンドを無害化して出力)
- ワークフローは既定で権限なし。収集ジョブは読み取りのみ、確定ジョブは `contents: write` で git 操作だけを行い、公開ジョブは `pages`/`id-token` のみ。checkout は認証情報を残さず、push 時だけトークンを渡す
- Pages の復元はハッシュで照合し、失敗・不一致・前回より欠けた状態では公開しない
- Action はコミット SHA で固定し、Dependabot (7日クールダウン) で更新

## 開発

規約・検証手順・レビュー観点は [development.md](development.md) を参照してください。
