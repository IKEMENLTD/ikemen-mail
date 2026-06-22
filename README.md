# Ikemen Mail — シンプルなメーラー

## 概要

Ikemen Mail は、Web 画面からメールを送信できるシンプルなメーラー Web アプリです。

- **サーバー**: Netlify（Functions + 静的ホスティング）
- **データベース**: Supabase（Postgres）
- **メール配信**: Resend

送信したメールは Supabase に記録され、一覧で確認できます。

## アーキテクチャ

```
ikemen-mail/
├── public/                 # フロントエンド（静的サイト）
├── netlify/
│   └── functions/
│       ├── send-mail.js    # メール送信 API
│       └── list-mails.js   # 送信履歴一覧 API
├── supabase/
│   └── schema.sql          # データベーススキーマ（emails テーブル）
├── netlify.toml            # Netlify 設定
├── package.json
└── .env.example            # 必要な環境変数の見本
```

- **public/**: ブラウザで動作するフロントエンド。メール作成フォームと送信履歴を表示します。
- **netlify/functions/**: サーバーレス関数。`send-mail` が Resend 経由でメールを送り、結果を Supabase に保存します。`list-mails` が送信履歴を取得します。
- **supabase/schema.sql**: `emails` テーブルとインデックス、RLS の定義です。

## API ドキュメント

### POST `/.netlify/functions/send-mail`

メールを送信します。

リクエストボディ（JSON）:

```json
{
  "to": "recipient@example.com",
  "subject": "件名",
  "body": "本文"
}
```

レスポンス（JSON）:

```json
{
  "ok": true,
  "id": "保存されたメールレコードの UUID"
}
```

### GET `/.netlify/functions/list-mails`

送信履歴を新しい順で取得します。

レスポンス（JSON）:

```json
{
  "ok": true,
  "mails": [
    {
      "id": "uuid",
      "to_email": "recipient@example.com",
      "subject": "件名",
      "body": "本文",
      "status": "sent",
      "error": null,
      "created_at": "2026-06-22T00:00:00.000Z"
    }
  ]
}
```

## セットアップ手順

### 1. Supabase プロジェクト作成 & スキーマ適用

1. [Supabase](https://supabase.com/) で新しいプロジェクトを作成します。
2. SQL Editor で `supabase/schema.sql` の内容を実行し、`emails` テーブルを作成します。
3. プロジェクトの **URL** と **service_role キー** を控えておきます（環境変数で使用）。

### 2. Resend API キー取得 & 送信元ドメイン認証

1. [Resend](https://resend.com/) でアカウントを作成し、API キーを発行します。
2. 送信元ドメインを登録し、DNS（SPF / DKIM）認証を完了させます。
3. 認証済みドメインのアドレス（例: `noreply@yourdomain.com`）を送信元として使用します。

### 3. Netlify 連携・環境変数設定

リポジトリを Netlify に連携し、ダッシュボードの環境変数に以下の 4 つを設定します。

| 環境変数 | 説明 |
| --- | --- |
| `SUPABASE_URL` | Supabase プロジェクトの URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase の service_role キー（サーバー専用シークレット） |
| `RESEND_API_KEY` | Resend の API キー（サーバー専用シークレット） |
| `FROM_EMAIL` | 認証済みの送信元アドレス |

`SUPABASE_SERVICE_ROLE_KEY` と `RESEND_API_KEY` はサーバー専用のシークレットです。必ず Netlify ダッシュボードの環境変数に設定し、リポジトリにコミットしないでください。

### 4. ローカル開発

```bash
npm install
npx netlify dev
```

ローカルで実行する際は、`.env.example` をコピーして `.env` を作成し、各値を設定してください。

```bash
cp .env.example .env
```

### 5. デプロイ

Netlify に連携済みであれば、デフォルトブランチへの push で自動デプロイされます。手動でデプロイする場合は次を実行します。

```bash
npx netlify deploy --prod
```

---

このプロジェクトは、複数のサブエージェントによってスキャフォールド（生成）されました。
