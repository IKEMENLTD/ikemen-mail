# 引き継ぎメモ (Standard Mailer)

最終更新: 2026-06-23

## 1. これは何か
単一パスワードでログインする Web メーラー。受信箱 / 送信済 / 下書きを持つ
**1つの共有メールボックス**。Supabase Auth は使わない。

- フロント: 静的サイト (`public/`)、素の HTML/CSS/JS。**Supabase JS は不使用**、CDN/フレームワーク無し
- バックエンド: Netlify Functions (`netlify/functions/`)。全 DB アクセスは **service_role** で実行
- DB: Supabase（`messages` テーブルのみ）
- メール送信: Resend

## 2. ブランチ / リポジトリ
- リポジトリ: `IKEMENLTD/ikemen-mail`
- 作業ブランチ: **`claude/simple-mailer-subagents-ujtcza`**（ここに全てpush済み。PRは未作成）
- 直近の主なコミット:
  - `ba0f9f5` バックエンドを単一パスワードゲートに刷新
  - `51debbc` フロントをフル機能メールクライアントに刷新
  - `4a03876` シミュレーションで検出した不整合を修正

## 3. アーキテクチャ / 認証フロー
1. `POST /login {password}` → サーバーが `LOGIN_PASSWORD` と timing-safe 比較
2. 一致で **HMAC-SHA256 署名トークン**（payload `{exp}`、既定7日）を発行
3. ブラウザは localStorage (`sm_token`) に保存し、以降のAPIに `Authorization: Bearer <token>`
4. `/login` 以外の全APIはトークン必須。401 を受けるとフロントはトークン破棄しログイン画面へ復帰
- 署名鍵 = `SESSION_SECRET` || `LOGIN_PASSWORD`
- ブラウザは Supabase に一切接続しない。`messages` は RLS 有効・**ポリシー無し**（＝anon全拒否、service_roleのFunctionsのみアクセス可）

## 4. API 契約（フロント↔バックエンド検証済み）
| メソッド・パス | 認証 | body | レスポンス |
|---|---|---|---|
| `POST /login` | 不要 | `{password}` | `{ok,token,expiresAt}` |
| `GET /list-messages?folder=inbox\|sent\|drafts` | Bearer | - | `{ok,messages:[...]}` |
| `POST /send-mail` | Bearer | `{to,subject,body,draftId?}` | `{ok,id}` |
| `POST /save-draft` | Bearer | `{id?,to,subject,body}` | `{ok,id}` |
| `POST /update-message` | Bearer | `{id,read}` | `{ok}` |
| `POST /delete-message` | Bearer | `{id}` | `{ok}` |
| `POST /inbound` | `x-inbound-secret` ヘッダー | `{from,to,subject,text}` | `{ok,id}` |

共有モジュール: `_auth.js`（署名/検証/requireAuth）、`_supabase.js`（service_roleクライアント）

## 5. DB スキーマ
`supabase/schema.sql` 参照。`messages` のみ。カラム:
`id, folder('inbox'|'sent'|'drafts'), from_email, to_email, subject, body, status, read(bool), error, created_at`
- `user_id` は無し。`(folder, created_at desc)` にindex
- スクリプトは再実行安全。旧 Auth設計（profiles/トリガー/user_id/旧ポリシー）からのマイグレーションも内包

## 6. 環境変数（`.env.example` 参照）
全てサーバー専用。ローカルは `.env`、本番は Netlify に設定。
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`（RLSバイパスの強権限・秘匿）
- `RESEND_API_KEY`, `FROM_EMAIL`（既定 `kouda@ikemen.ltd`）
- `LOGIN_PASSWORD`（現状 `H61jia75qyvAh`）
- `SESSION_SECRET`（任意・未設定なら LOGIN_PASSWORD を使用。本番は長いランダム推奨）
- `INBOUND_SECRET`（任意・空だと受信無効）

> セキュリティ注意: `LOGIN_PASSWORD` の実値が `.env.example` にコミットされている（依頼による）。
> リポジトリ共有時はローテーション推奨。本番値は Netlify のみに置くのが理想。

## 7. フロント機能（`public/app.js` / `index.html` / `styles.css`）
ログイン(表示切替/ローディング/エラー) / レスポンシブ3ペイン / フォルダ別バッジ(受信箱は未読数) /
検索フィルタ / 相対日時 / 未読強調 / 閲覧ペイン(返信・転送・既読↔未読・削除[確認付]) /
作成モーダル(バリデーション・送信中表示・下書き自動保存[1.5sデバウンス]) / トースト /
401復帰 / 受信箱60秒自動更新+タブ復帰時 / キーボード(Esc, Ctrl+Enter送信, c で作成) /
全描画 textContent で XSS 対策。

## 8. 検証状況（済み）
- バックエンド: 全Functionを実ファイルでモック実行する **54シナリオ自動テストを全PASS**
  （メソッド/認証/JSON/バリデーション/Resend成功・失敗・例外/draft削除/inbound/DBエラー/トークン往復・改ざん・期限切れ）
  ※テストは使い捨て（`node_modules` 配下のスタブで実行し削除済み）。**常設の自動テストは未整備**
- フロント: 全コードをトレースし不整合修正済み。`node --check` 通過
- 既知の軽微な修正済み: 送信失敗判定 `status==="error"`→`"failed"` / `enterApp` の受信箱二重ロード解消 / `prefers-reduced-motion` 追加

## 9. 次の人がやること
### 必須（デプロイ設定。コードからは触れない）
1. Supabase で `supabase/schema.sql` を実行
2. Netlify に §6 の環境変数を設定
3. Resend で `ikemen.ltd` ドメイン検証（SPF/DKIM）。未検証だと送信失敗
4. 受信を使うなら inbound webhook を `/.netlify/functions/inbound` に向け `INBOUND_SECRET` 設定

### 任意（未着手）
- PR作成（未作成）
- 回帰テストの常設化（§8のシミュレーションを `test/` + `npm test` 化、Web用 SessionStart フック）
- 見送り機能: ページネーション / 複数選択・一括削除 / 全既読 / 削除Undo / 添付ファイル / スレッド表示
- `netlify dev` での実機ブラウザ確認（環境変数が無いとログイン以降は動かない）

## 10. ローカル起動
```bash
cp .env.example .env   # 各値を設定
npm install
npx netlify dev
```
