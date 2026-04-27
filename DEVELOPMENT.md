# Development

このファイルは、google-tool-mcp をローカルで改変、検証、リリース準備する人向けの手順です。利用者向けの使い方は [README.md](README.md) を参照してください。

## 前提

- Node.js 18 以降
- npm
- Google Cloud の Desktop app OAuth client JSON

## セットアップ

依存関係を入れて TypeScript をビルドします。

```sh
npm install
npm run build
```

ローカル checkout から CLI を起動する:

```sh
node ./bin/google-tool.js --print-config-dir
node ./bin/google-tool.js
```

ローカル checkout から MCP サーバーを起動する:

```sh
node ./bin/google-tool-mcp.js
```

## 設定ファイル

既定の認証ファイル配置先:

- `~/.config/google-tool/credentials.json`
- `~/.config/google-tool/token.json`

開発中にアカウントや環境を分ける場合は、`GOOGLE_TOOL_PROFILE`、`GOOGLE_TOOL_CREDENTIALS`、`GOOGLE_TOOL_TOKEN` を使ってください。

## テスト

全テストを実行する:

```sh
npm test
```

TypeScript のビルドだけ確認する:

```sh
npm run build
```

## dist の扱い

このリポジトリは `dist/` を含めています。`src/` を変更した場合は、次を実行して `dist/` も更新してください。

```sh
npm run build
```

## パッケージ metadata

`package.json` の `bin` は以下を公開します。

- `google-tool`: `./bin/google-tool.js`
- `google-tool-mcp`: `./bin/google-tool-mcp.js`

npm registry には公開していません。利用者向け README では、GitHub リポジトリを `npx --package=git+https://...` で直接指定する形を案内しています。

## 変更時の確認

公開前に最低限確認すること:

```sh
npm run build
npm test
git diff --check
```

認証や OAuth scope まわりを変更した場合は、README と [SECURITY.md](SECURITY.md) の説明も合わせて確認してください。
