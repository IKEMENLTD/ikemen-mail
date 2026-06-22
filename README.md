# Ikemen Mail — シンプルなメールクライアント

## 概要

Ikemen Mail は、ログイン認証付きの Web メーラー（メールクライアント）です。受信箱・送信済・下書きのフォルダを持ち、ブラウザからメールの作成・送信・閲覧ができます。

- **サーバー**: Netlify（Functions + 静的ホスティング）
- **データベース & 認証**: Supabase（Postgres + Auth）
- **メール配信**: Resend

## 主な機能

- ログイン / 新規登録（メールアドレス + パスワード）
- メールの作成・送信
- 下書きの保存
- 送信済 / 受信箱の閲覧
- 既読 / 未読の管理
- メールの削除

## アーキテクチャ

```
ikemen-mail/
├── public/                 # フロントエンド（静的サイト）
│   ├── config.js           # ブラウザ用 Supabase URL + anon キー（要設定）
│   └── config.example.js   # config.js の見本
├── netlify/
│   └── functions/
│       ├── send-mail.js     # メール送信 API（JWT 検証 + Resend 送信 + DB 記録）
│       └── inbound.js       # 受信 Webhook（インバウンドメールの取り込み）
├── supabase/
│   └── schema.sql           # スキーマ（messages / profiles + RLS + トリガー）
├── netlify.toml
├── package.json
└── .env.example             # サーバー用環境変数の見本
```

- **public/**: ブラウザで動作するフロントエンド。Supabase の JS クライアントを CDN の ESM で読み込み、anon キー + ユーザー JWT で接続します。RLS により自分のデータのみを参照・操作できます。
- **netlify/functions/**: サーバーレス関数。
  - `send-mail`: リクエストの JWT を検証してユーザーを特定し、Resend 経由でメールを送信、結果を `messages`（folder = `sent`）に記録します。
  - `inbound`: 受信 Webhook。共有シークレットを検証し、受信メールを対象ユーザーの受信箱（folder = `inbox`）に取り込みます。
- **supabase/schema.sql**: `messages` / `profiles` テーブル、インデックス、RLS ポリシー、新規ユーザー作成時に profile を自動生成するトリガーを定義します。

## セキュリティ設計

- **ブラウザ（public/）**: Supabase の **anon キー** と **ログイン中ユーザーの JWT** で接続します。すべてのアクセスは RLS ポリシー（`auth.uid() = user_id`）で制約され、ユーザーは自分の行のみ閲覧・変更できます。anon キーは公開前提で、保護は RLS が担います。
- **サーバー（netlify/functions/）**: **service_role キー**を使用します。これは RLS をバイパスする強い権限のため、サーバー専用シークレットとして Netlify の環境変数にのみ設定し、決してブラウザに渡しません。

## API ドキュメント

### POST `/.netlify/functions/send-mail`

メールを送信します。ログイン中ユーザーのアクセストークンが必要です。

- ヘッダー: `Authorization: Bearer <access_token>`
- リクエストボディ（JSON）:

```json
{
  "to": "recipient@example.com",
  "subject": "件名",
  "body": "本文"
}
```

- レスポンス（JSON）:

```json
{
  "ok": true,
  "id": "保存されたメッセージレコードの UUID"
}
```

### POST `/.netlify/functions/inbound`

受信メールを取り込む Webhook です。Resend などのインバウンド Webhook をこのエンドポイントに向けて設定します。

- ヘッダー: `x-inbound-secret: <INBOUND_SECRET>`
- リクエストボディ（JSON）:

```json
{
  "from": "sender@example.com",
  "to": "user@yourdomain.com",
  "subject": "件名",
  "text": "本文"
}
```

- レスポンス（JSON）:

```json
{
  "ok": true,
  "id": "保存されたメッセージレコードの UUID"
}
```

## セットアップ手順

### 1. Supabase プロジェクト作成 & スキーマ適用

1. [Supabase](https://supabase.com/) で新しいプロジェクトを作成します。
2. SQL Editor で `supabase/schema.sql` の内容を実行し、`messages` / `profiles` テーブル、RLS、トリガーを作成します。
3. Authentication でメール / パスワード認証を有効化します。必要に応じてメール確認（email confirmation）の設定を行ってください。
4. プロジェクトの **URL**、**anon キー**、**service_role キー** を控えておきます。

### 2. ブラウザ用 config.js の設定

`public/config.example.js` を参考に `public/config.js` を作成し、Supabase の **URL** と **anon キー** を設定します。これらは公開前提の値で、保護は RLS が担います。

### 3. Resend 設定

1. [Resend](https://resend.com/) の API キーを用意します（既存プロジェクトのキーを流用可）。
2. 送信元ドメイン `ikemen.ltd` を Resend に登録し、DNS（SPF / DKIM）認証を完了させます。
3. 送信元アドレスは **`kouda@ikemen.ltd`**（コード既定値）を使用します。`FROM_EMAIL` で上書き可能です。

> **重要**: Resend は検証済みドメインのアドレスからしか送信できません。流用する Resend アカウントに `ikemen.ltd` が登録・認証されている必要があります。未登録の場合はドメイン認証を行ってください。

### 4. Netlify 環境変数設定

Netlify ダッシュボードの環境変数に以下を設定します（`.env.example` 参照）。

| 環境変数 | 説明 |
| --- | --- |
| `SUPABASE_URL` | Supabase プロジェクトの URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー（サーバー専用シークレット、RLS をバイパス） |
| `RESEND_API_KEY` | Resend の API キー（サーバー専用シークレット） |
| `FROM_EMAIL` | 送信元アドレス（未設定時は既定で `kouda@ikemen.ltd`） |
| `INBOUND_SECRET` | （任意）`/inbound` Webhook の共有シークレット。空にすると受信機能を無効化 |

`SUPABASE_SERVICE_ROLE_KEY` と `RESEND_API_KEY` はサーバー専用シークレットです。必ず環境変数として設定し、リポジトリにコミットしないでください。

### 5. ローカル開発

```bash
npm install
npx netlify dev
```

ローカルで実行する際は、`.env.example` をコピーして `.env` を作成し、各値を設定してください。

```bash
cp .env.example .env
```

### 6. デプロイ

Netlify に連携済みであれば、デフォルトブランチへの push で自動デプロイされます。手動でデプロイする場合は次を実行します。

```bash
npx netlify deploy --prod
```

なお、受信（inbound）機能を使う場合は、Resend などのインバウンド Webhook を `/.netlify/functions/inbound` に向けて設定してください。

---

このプロジェクトは、複数のサブエージェントによってスキャフォールド（生成）されました。
