# Security

google-tool-mcp は Gmail と Google Drive に read-only でアクセスします。利用前に、このファイルの認証情報と権限の扱いを確認してください。

## 要求する OAuth scope

このツールは以下の scope を要求します。

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/drive.metadata.readonly`

Gmail ではメッセージ一覧、ラベル、メッセージ本文を読み取れます。Google Drive ではファイル metadata を読み取れます。Drive のファイル本文はダウンロードしません。

このツールは Gmail や Drive への書き込み、変更、削除を行いません。

## 認証情報

以下のファイルは個人用の認証情報です。

- `credentials.json`
- `token.json`

既定の配置先:

- `~/.config/google-tool/credentials.json`
- `~/.config/google-tool/token.json`

これらのファイルを GitHub、npm、チャット、Issue、ログなどに公開しないでください。このリポジトリの `.gitignore` では、リポジトリ内に置かれた `credentials.json` と `token.json` を除外しています。

## 漏えいした場合

`credentials.json` が漏えいした場合:

1. Google Cloud Console で該当 OAuth client secret をローテーション、または OAuth client を削除します。
2. 新しい Desktop app OAuth client を作成します。
3. 新しい `credentials.json` を配置します。

`token.json` が漏えいした場合:

1. Google アカウントのセキュリティ設定で、このアプリへのアクセスを取り消します。
2. ローカルの `token.json` を削除します。
3. 再度 OAuth 認証します。

## ログと共有

エラーや Issue を共有するときは、以下を含めないでください。

- `credentials.json` の内容
- `token.json` の内容
- OAuth callback URL に含まれる `code`
- Gmail 本文、Drive ファイル名、Drive ID などの個人情報

## 脆弱性の報告

脆弱性や認証情報漏えいにつながる問題を見つけた場合は、公開 Issue に秘密情報を貼らないでください。GitHub の private vulnerability reporting が有効な場合は、リポジトリの Security タブから非公開で報告してください。

private vulnerability reporting が使えない場合は、秘密情報を含めずに公開 Issue で「非公開で共有すべきセキュリティ問題がある」ことだけを連絡してください。Issue には `credentials.json`、`token.json`、OAuth code、メール本文、Drive の個人情報を貼らないでください。
