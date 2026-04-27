# Google Tool MCP Server

Google Tool は、Gmail のメッセージと Google Drive のファイル metadata を AI エージェントから参照するための MCP サーバーです。補助用の CLI も同梱しています。

- Gmail のメッセージ一覧、ラベル一覧、メッセージ本文、対応するテキスト添付ファイルを read-only で取得できます
- Google Drive のアカウント情報、ファイル一覧、ファイル metadata を read-only で取得できます
- Google Drive のファイル本文はダウンロードしません
- Gmail や Drive への書き込み、変更、削除は行いません

Node.js 18 以降が必要です。npm registry には公開していないため、通常は GitHub リポジトリを `npx` で直接指定して使います。

## 権限

このツールは OAuth で以下の scope を要求します。

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/drive.metadata.readonly`

`credentials.json` と `token.json` は個人用の認証情報です。GitHub、npm、チャット、Issue、ログなどに公開しないでください。詳しくは [SECURITY.md](SECURITY.md) を参照してください。

## Quick Start

### 1. Google Cloud で credentials.json を用意する

1. Google Cloud の対象プロジェクトで Gmail API と Google Drive API を有効化します。
2. OAuth consent screen を設定します。外部ユーザー種別でテスト中の場合は、使う Google アカウントを test users に追加します。
3. OAuth クライアント ID を作成します。
4. Application type は `Desktop app` を選びます。
5. ダウンロードした JSON を `credentials.json` という名前で保存します。

既定の配置先は以下です。

```text
~/.config/google-tool/credentials.json
```

設定ディレクトリは、MCP サーバーまたは CLI が既定パスを参照したときに自動作成します。`credentials.json` 自体は自動生成されません。

まだ `~/.config/google-tool/` が存在しない場合は、ディレクトリを作成してから `credentials.json` を配置してください。先に MCP ツールを呼び出した場合は、ツール側がディレクトリを作成し、`credentials.json` の配置先を案内します。

配置先を変える場合は、MCP クライアント設定の環境変数で `GOOGLE_TOOL_CREDENTIALS` にフルパスを指定してください。

### 2. MCP クライアントに登録する

VS Code の `mcp.json` 例:

```json
{
  "servers": {
    "google-tool": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git",
        "google-tool-mcp"
      ],
      "type": "stdio"
    }
  }
}
```

Codex CLI の `~/.codex/config.toml` 例:

```toml
[mcp_servers.google_tool]
command = "npx"
args = ["--yes", "--package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git", "google-tool-mcp"]
startup_timeout_sec = 30
enabled = true
```

上記は GitHub の default branch を使う構成です。通常はこのままで最新の内容を使えます。特定の版に固定したい場合だけ、`git+https://github.com/KitaYoshihiro/google-tool-mcp.git#<tag-or-commit>` のように tag または commit SHA を指定してください。

### 3. 初回認証する

MCP クライアントから任意の Google Tool を呼び出します。`credentials.json` が存在すれば、ブラウザ認証が開始されます。認証が完了すると、既定では以下に `token.json` が保存されます。

```text
~/.config/google-tool/token.json
```

`credentials.json` が見つからない場合、ツールは配置先を案内するエラーを返します。その場合は `credentials.json` を配置してから、同じツール呼び出しを再試行してください。

## 設定ファイル

既定では、OAuth 関連ファイルは全 OS 共通で `~/.config/google-tool/` に置かれます。

- `~/.config/google-tool/credentials.json`
- `~/.config/google-tool/token.json`

利用できる環境変数:

- `GOOGLE_TOOL_PROFILE`: プロファイル名を指定します
- `GOOGLE_TOOL_CREDENTIALS`: `credentials.json` のフルパスを指定します
- `GOOGLE_TOOL_TOKEN`: `token.json` のフルパスを指定します

複数アカウントや複数 MCP サーバーを分けて使う場合は、サーバープロセスごとに `GOOGLE_TOOL_PROFILE` を変えてください。たとえば `GOOGLE_TOOL_PROFILE=work` の場合、既定パスは以下になります。

- `~/.config/google-tool/profiles/work/credentials.json`
- `~/.config/google-tool/profiles/work/token.json`

`GOOGLE_TOOL_PROFILE` を使っていて `GOOGLE_TOOL_CREDENTIALS` を明示していない場合、`credentials.json` は次の順で探索します。

1. `~/.config/google-tool/profiles/<profile>/credentials.json`
2. `~/.config/google-tool/credentials.json`

これにより、`token.json` はプロファイルごとに分離しつつ、`credentials.json` は共通ディレクトリに 1 つだけ置く運用ができます。

`GOOGLE_TOOL_PROFILE` には、英数字に加えて `.`, `_`, `+`, `@`, `-` を使えます。

## 複数アカウント

Codex CLI で個人用と仕事用を分ける例:

```toml
[mcp_servers.google_tool_personal]
command = "npx"
args = ["--yes", "--package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git", "google-tool-mcp", "--profile=personal", "--drive=off"]
startup_timeout_sec = 30
enabled = true

[mcp_servers.google_tool_work]
command = "npx"
args = ["--yes", "--package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git", "google-tool-mcp", "--profile=work", "--gmail=off"]
startup_timeout_sec = 30
enabled = true
```

`google-tool-mcp` には起動時オプションとして `--gmail=on|off` と `--drive=on|off` があります。省略時はどちらも `on` です。

## MCP ツール

公開されるツール:

- `whoami`: 認証済みアカウントと有効な機能を確認します
- `list_gmail_messages`: Gmail メッセージ一覧を取得します
- `list_gmail_labels`: Gmail ラベル一覧を取得します
- `read_gmail_message`: Gmail メッセージを 1 件取得します
- `list_gmail_attachments`: Gmail メッセージ 1 件の添付ファイル一覧を取得します
- `read_gmail_attachment_text`: 対応するテキスト添付ファイルを読み取ります
- `get_drive_about`: Google Drive のアカウント情報と容量を取得します
- `list_drive_files`: Google Drive のファイル metadata 一覧を取得します
- `read_drive_file`: Google Drive のファイル metadata を 1 件取得します

`read_gmail_attachment_text` は、明示した `message_id` と `attachment_id` の添付ファイルだけを読み取ります。対応する形式は、`text/plain`、`text/csv`、`text/tab-separated-values`、`text/html`、`text/markdown`、`application/json`、`application/xml`、`text/xml` と、同等の拡張子を持つテキストファイルです。PDF、Office 文書、画像、zip などのバイナリ添付ファイルは読み取りません。既定では `max_bytes=1048576`、`max_chars=5000` で読み取り量と返却量を制限します。

`list_drive_files.query` には Google Drive API の `files.list.q` をそのまま渡します。

例:

- `name contains '議事録' and trashed = false`
- `fullText contains 'プロジェクトA' and trashed = false`
- `fullText contains '契約更新' and mimeType = 'application/pdf' and trashed = false`
- `fullText contains '契約更新' and mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and trashed = false`
- `fullText contains '予算案' and mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and trashed = false`
- `fullText contains 'ロードマップ' and mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' and trashed = false`
- `fullText contains '議事録' and mimeType = 'application/vnd.google-apps.document' and trashed = false`
- `mimeType = 'application/vnd.google-apps.folder' and name contains '経理' and trashed = false`
- `'folder-id' in parents and trashed = false`

サーバー側では `include_trashed = false` が既定なので、通常はゴミ箱を除外した検索になります。

## CLI

CLI は MCP の補助として使えます。PATH に `google-tool` が無い環境でも動くよう、以下では `npx` から実行する例だけを示します。

設定ディレクトリを確認する:

```sh
npx --yes --package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git google-tool --print-config-dir
```

未読メールを確認する:

```sh
npx --yes --package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git google-tool --query "is:unread" --max-results 5
```

ユーザー作成ラベルを確認する:

```sh
npx --yes --package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git google-tool --list-labels
```

Drive でファイル名検索する:

```sh
npx --yes --package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git google-tool --drive-query "name contains '議事録'" --max-results 5
```

Drive のファイル ID から metadata を確認する:

```sh
npx --yes --package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git google-tool --drive-file-id "FILE_ID"
```

## Troubleshooting

### credentials.json がない

`~/.config/google-tool/credentials.json` に Desktop app OAuth client JSON を配置してください。別の場所に置く場合は、MCP クライアント設定で `GOOGLE_TOOL_CREDENTIALS` を指定してください。

### token.json がない

`credentials.json` が存在する状態で MCP ツールを呼び出すと、ブラウザ認証が開始されます。認証完了後に `token.json` が保存されます。

### scope が不足している

既存の `token.json` に必要な scope が含まれていない場合は、同じ MCP ツール呼び出しを再試行して再認証してください。必要に応じて古い `token.json` を退避または削除してから認証し直してください。

### ブラウザが開かない

ツールが表示する認証 URL を手動でブラウザに貼り付けて認証してください。認証後、ローカルの loopback callback に戻ることで `token.json` が保存されます。

### google-tool コマンドが見つからない

この README の利用者向け手順では、`google-tool` が PATH にあることを前提にしていません。CLI を使う場合は、`npx --yes --package=git+https://github.com/KitaYoshihiro/google-tool-mcp.git google-tool ...` の形で実行してください。

## 開発・改変

ローカル checkout でのビルド、テスト、dist 更新、リリース準備は [DEVELOPMENT.md](DEVELOPMENT.md) を参照してください。

## ライセンス

[MIT](LICENSE)
