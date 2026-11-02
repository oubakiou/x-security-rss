# x-security-rss

X (旧Twitter) からサイバーセキュリティの話題を毎日収集し、RSS として配信します。

- 収集: xAI Responses API の `x_search` ツール (Grok) — `src/fetch.ts`
- 生成: RSS 2.0 (`feed.xml`) と一覧ページ (`index.html`) — `src/build.ts`
- 実行: GitHub Actions で毎日 06:23 JST (`.github/workflows/daily.yml`)
- 配信: GitHub Pages — **https://oubakiou.github.io/x-security-rss/feed.xml**

## セットアップ

1. **APIキー**: [console.x.ai](https://console.x.ai) でクレジットをチャージし、API キーを発行。
   リポジトリの Settings → Secrets and variables → Actions → **Secrets** に `XAI_API_KEY` として登録。
2. **Pages**: Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定。
3. Actions タブから **Daily X security feed** を `Run workflow` で手動実行して動作確認。

任意の設定 (Actions の **Variables**):

| 変数        | 既定値     | 説明                                    |
| ----------- | ---------- | --------------------------------------- |
| `XAI_MODEL` | `grok-4.3` | 使用モデル                              |
| `MAX_ITEMS` | `15`       | 1日あたりの最大件数                     |
| `MAX_TURNS` | `3`        | 検索の往復回数の上限 (費用の上限に効く) |

## 失敗したとき

収集に失敗すると次のようになります。

- フィードの先頭に「⚠️ 収集に失敗しました」記事が出る (エラー内容つき)
- ワークフローが失敗扱いになり、GitHub から通知メールが届く

よくある原因: API キーの失効 (`HTTP 400/401`) → キーを再発行して Secret を更新。
クレジット切れ (`HTTP 402/429`) → console.x.ai でチャージ。

## 開発

Node.js 26 / npm 12 / [Vite+](https://viteplus.dev)。npm は `.npmrc` で
`min-release-age=7` (公開から7日未満のバージョンを入れない) を設定しています。

```bash
vp install
vp check      # format + lint + type check
vp test       # in-source tests (src/lib/*.ts の import.meta.vitest)
XAI_API_KEY=... vp run fetch
vp run build
```
