# Standard Mailer — シンプルなメールクライアント

## 概要

Standard Mailer は、**単一パスワードでログイン**する Web メーラー（メールクライアント）です。受信箱・送信済・下書きのフォルダを持つ、**1 つの共有メールボックス**を扱います。

- **サーバー**: Netlify Functions + 静的サイト
- **データベース**: Supabase（Functions が **service_role** でアクセスし、ブラウザは直接触れません）
- **メール配信**: Resend

## 認証

単一パスワードゲート方式です。

- `LOGIN_PASSWORD` 環境変数に設定したパスワードでログインします。
- ログインに成功すると、サーバーが**署名付きセッショントークン（HMAC）**を発行します。
- 以降の API 呼び出しには、このトークンを `Authorization: Bearer <token>` ヘッダーで付与します。

ユーザー登録（サインアップ）やユーザーごとのアカウントはありません。Supabase Auth は使用しません。

## アーキテクチャ

```
ikemen-mail/
├── public/                 # フロントエンド（素の HTML / CSS / JS）
│                           #   Functions を fetch で呼ぶ。Supabase JS は不使用
├── netlify/
│   └── functions/
│       ├── login.js          # パスワード検証 + セッショントークン発行
│       ├── list-messages.js  # フォルダ内メッセージ一覧
│       ├── send-mail.js      # メール送信（Resend）+ DB 記録
│       ├── save-draft.js     # 下書き保存
│       ├── update-message.js # 既読フラグ更新など
│       ├── delete-message.js # メッセージ削除
│       ├── inbound.js        # 受信 Webhook（インバウンド取り込み）
│       ├── _auth.js          # 共有: トークン署名・検証
│       └── _supabase.js      # 共有: service_role クライアント生成
├── supabase/
│   └── schema.sql            # messages テーブルのみ（RLS 有効・ポリシー無し）
├── netlify.toml
├── package.json
└── .env.example              # サーバー用環境変数の見本
```

- **public/**: ブラウザで動作するフロントエンド。素の HTML / CSS / JS で、Netlify Functions を `fetch` で呼び出します。**Supabase JS クライアントは使用しません**。
- **netlify/functions/**: サーバーレス関数。すべての DB アクセスは **service_role** キーで行われ、RLS をバイパスします。`_auth.js` / `_supabase.js` は共有モジュールです。
- **supabase/schema.sql**: `messages` テーブルのみを定義します。RLS は**有効**ですが**ポリシーは定義しません**（＝直接アクセスは全拒否。service_role バックエンドのみが触れます）。

## セキュリティ設計

- **ブラウザ（public/）**: Supabase には一切接続しません。Netlify Functions のみを呼び出し、ログイン後はセッショントークン（HMAC 署名）を Bearer で付与します。
- **サーバー（netlify/functions/）**: Supabase の **service_role キー**を使用します。これは RLS をバイパスする強い権限のため、サーバー専用シークレットとして Netlify の環境変数にのみ設定し、決してブラウザに渡しません。
- **messages テーブル**: RLS を有効化しつつポリシーを 1 つも作らないことで、anon / public からの直接アクセスを完全に拒否します。アクセスできるのは service_role を持つ Functions だけです。

## API ドキュメント

エンドポイントは `/.netlify/functions/<name>` です。**`/login` 以外のすべての API（末尾の `/inbound` を含む）は、`Authorization: Bearer <token>` のセッショントークンが必須**です。`/inbound` は加えて共有シークレットを使います。

| メソッド・パス | 認証 | リクエストボディ | レスポンス |
| --- | --- | --- | --- |
| `POST /login` | 不要 | `{ "password": "..." }` | `{ "ok": true, "token": "...", "expiresAt": "..." }` |
| `GET /list-messages?folder=inbox\|sent\|drafts` | Bearer | （なし） | `{ "ok": true, "messages": [ ... ] }` |
| `POST /send-mail` | Bearer | `{ "to", "subject", "body", "draftId"? }` | `{ "ok": true, "id": "..." }` |
| `POST /save-draft` | Bearer | `{ "id"?, "to", "subject", "body" }` | `{ "ok": true, "id": "..." }` |
| `POST /update-message` | Bearer | `{ "id", "read" }` | `{ "ok": true }` |
| `POST /delete-message` | Bearer | `{ "id" }` | `{ "ok": true }` |
| `POST /inbound` | `x-inbound-secret` ヘッダー | `{ "from", "to", "subject", "text" }` | `{ "ok": true, "id": "..." }` |

- `POST /login`: パスワードを検証し、署名付きセッショントークンと有効期限を返します。
- `GET /list-messages`: 指定フォルダ（`inbox` / `sent` / `drafts`）のメッセージを新しい順に返します。
- `POST /send-mail`: Resend 経由でメールを送信し、`messages`（folder = `sent`）に記録します。`draftId` を指定すると、送信後に該当下書きを処理できます。
- `POST /save-draft`: 下書きを保存します。`id` 指定で既存下書きを更新、未指定で新規作成します。
- `POST /update-message`: メッセージの既読フラグなどを更新します。
- `POST /delete-message`: メッセージを削除します。
- `POST /inbound`: 受信 Webhook。`x-inbound-secret` ヘッダーで共有シークレットを検証し、受信メールを受信箱（folder = `inbox`）に取り込みます。

## セットアップ手順

### 1. Supabase プロジェクト作成 & スキーマ適用

1. [Supabase](https://supabase.com/) で新しいプロジェクトを作成します。
2. SQL Editor で `supabase/schema.sql` の内容を実行し、`messages` テーブル（RLS 有効・ポリシー無し）を作成します。
3. プロジェクトの **URL** と **service_role キー** を控えておきます。

### 2. Resend 設定

1. [Resend](https://resend.com/) の API キーを用意します。
2. 送信元ドメイン `ikemen.ltd` を Resend に登録し、DNS（SPF / DKIM）認証を完了させます。
3. 送信元アドレスは **`kouda@ikemen.ltd`**（既定値）を使用します。`FROM_EMAIL` で上書き可能です。

> **重要**: Resend は検証済みドメインのアドレスからしか送信できません。`ikemen.ltd` が登録・認証されている必要があります。

### 3. Netlify 環境変数設定

Netlify ダッシュボードの環境変数に以下を設定します（`.env.example` 参照）。

| 環境変数 | 説明 |
| --- | --- |
| `SUPABASE_URL` | Supabase プロジェクトの URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー（サーバー専用シークレット、RLS をバイパス） |
| `RESEND_API_KEY` | Resend の API キー（サーバー専用シークレット） |
| `FROM_EMAIL` | 送信元アドレス（既定で `kouda@ikemen.ltd`） |
| `LOGIN_PASSWORD` | 単一パスワードゲートのログインパスワード |
| `SESSION_SECRET` | （任意）セッショントークンの HMAC 署名シークレット。未設定時は `LOGIN_PASSWORD` を使用 |
| `INBOUND_SECRET` | （任意）`/inbound` Webhook の共有シークレット。空にすると受信機能を無効化 |

`SUPABASE_SERVICE_ROLE_KEY` と `RESEND_API_KEY`、`LOGIN_PASSWORD` はシークレットです。環境変数として設定し、リポジトリに実値をコミットしないでください。

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

受信（inbound）機能を使う場合は、Resend などのインバウンド Webhook を `/.netlify/functions/inbound` に向けて設定してください。

---

このプロジェクトは、複数のサブエージェントによって構築（スキャフォールド）されました。
