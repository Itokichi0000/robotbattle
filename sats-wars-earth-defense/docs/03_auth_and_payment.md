# 03 — Auth and payment / 認証と決済

**現状（Phase 1）**：認証は sandbox の `DEMO GUEST` のみ。決済は存在しない。`APP_MODE=live` はサーバーが起動を拒否する。
この文書は Phase 3/4 の実装方針と、すでに入っている安全策をまとめる。

## すでにあるもの

- パイロットセッション：ランダム 32 バイトのトークンを `sw_pilot` Cookie（HttpOnly・SameSite=Lax・https では Secure）に入れ、
  DB には SHA-256 のみ保存。期限 3 日。運営は `sw_operator`（SameSite=Strict、14 時間）。
- 公開名は `PILOT-XXXX`（ランダム 4 桁 16 進）。鍵やIDから作らない。公開スナップショットに内部 ID を含めない。
- Cookie を伴う変更系 HTTP は `Origin` 検査（CSRF）。ソケットのハンドシェイクも同様。
- 運営パスワードは SHA-256 してから `timingSafeEqual`。ログイン成功/失敗は監査ログ（IP のみ記録、パスワードは記録しない）。
- 本番は `OPERATOR_PASSWORD`（12文字以上）と https の `PUBLIC_BASE_URL` 必須、厳格 CSP（eval 不可）・HSTS。

## Phase 3：LNURL-auth（LUD-04）— パイロット認証（無料・送金なし）

一次仕様：https://github.com/lnurl/luds/blob/luds/04.md

1. `POST /api/auth/attempt` → `authAttemptId`、`k1`（32 バイト CSPRNG、hex）、期限（例 5 分）、ウォレット URL
   `https://<domain>/api/auth/lnurl?tag=login&k1=<hex>&action=login`（bech32 `LNURL...` と `lightning:` / `keyauth://` リンク）。
   試行はブラウザの Cookie に紐づけ、他人の試行は参照できない。
2. ウォレットが `GET /api/auth/lnurl?...&sig=<DER hex>&key=<33byte 圧縮公開鍵 hex>` を呼ぶ。サーバーは
   入力形式 → k1 の存在・期限・未使用 → secp256k1 署名検証（`@noble/curves`、実績ある実装）→ k1 を使用済みに（1回限り）→
   `linkingKey` の SHA-256 から仮名パイロットを作成/再利用 → `{"status":"OK"}`。失敗は `{"status":"ERROR","reason":...}`。
3. ブラウザは自分の `authAttemptId` をポーリング（`GET /api/auth/attempt/:id/status`）し、完了ならセッション Cookie を受け取る。
   別端末で承認した場合も、試行を作ったブラウザだけがログインできる。
4. 同じウォレットで別端末からログインした場合：新セッションを発行し、同じ試合での二重席占有はエンジンが拒否（`pilotId` 一意）。
5. 拒否すべきもの（テストで固定）：k1 再利用・期限切れ・署名なし/改ざん・不正形式・別の試行の k1・ドメイン不一致。
6. UI：「パイロット認証（無料）」と明記。同じスマホでウォレットを開くボタン、リンクコピー、別端末用の個人 QR（大画面には出さない）。
   失敗理由別の再試行（期限切れ／非対応ウォレット／通信不可）。「支払えばログインできる」と誘導しない。
7. DEMO GUEST は運営が許可したときだけ（`DEMO_GUEST_ENABLED`）。本番認証済みと偽らない。

## Phase 4：共有エネルギーパルス（Lightning 決済）

一次仕様（参考）：https://github.com/lnurl/luds/blob/luds/06.md

- 意味：仲間の共同メカへ送る「共有エネルギーパルス」。**固定 21 sats → TEAM CAPACITOR +20**（運営設定可）。
  1人 30 秒に1回・1試合最大3回。金額を増やしても強くならない。支払いなしでも勝てる。
- 流れ：スマホで実額・受取先・返金不可の可能性を表示 → 明示確認 → `PaymentIntent` 作成 → 個別 BOLT11 →
  利用者自身が支払う → サーバーがバックエンドに **再照会して settled を確認**（Webhook はきっかけ）→ `paymentHash` 一意で
  **一度だけ** `sats_pulse_settled` を適用 → 全員に演出。pending / expired / failed / canceled を表示。試合は止めない。
- 試合終了後に settled になったパルス：次ラウンドへ繰り越さず「未反映」として監査ログに記録し、運営対応（仕様 §8.4）。
- アダプター（仕様 §8.4 の `PaymentProvider`）：
  - `SandboxPaymentProvider`：架空のお金だけ。運営画面からのみ「テスト入金確定」。画面に **VIRTUAL** と表示。
  - `LivePaymentProvider`（LNbits 等）：**Invoice/read key のみ**。送金・Admin key は使わない。キーはサーバー環境変数のみ。
    環境変数がそろわなければ接続しない。
- LIVE 化の条件：オーナーの明示承認＋運営画面で受取先・上限・注意書き・Webhook 到達を確認して別途承認。起動時から LIVE にしない。
- LNURL-auth の鍵で支払い本人を証明したと主張しない（支払いはセッションが発行した個別 invoice で帰属させる）。

## 承認が必要なこと

- 実決済の有効化、受取先ウォレット/LNbits の用意、少額の実地試験。
- 公開ドメイン・TLS・デプロイ。
- 実機ウォレット（2種類以上）での LNURL-auth 試験の実施判断（端末がなければ未実施と明記する）。
