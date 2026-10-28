# PAYMENT_FLOW — Lightning 決済（クレジット制）

> **既定は `PAYMENT_MODE=mock`（実際の sats は動かない）。**
> `PAYMENT_MODE=lnbits` はオーナーの明示承認のうえ `ALLOW_REAL_PAYMENTS=true` を設定しない限りサーバーが起動を拒否する。
> 本物の資金を使うテストはオーナー承認時のみ実施する。

ZAP BATTLE（D-023）では「1回チャージ → タップごとに残高から21 sats」の**前払いクレジット制**。
パンチのたびに請求書を払わせない（会場の人は1回だけウォレットを開けばよい）。

## フロー

```
/play            server                                   provider (mock | LNbits)
 │ POST /api/players {teamId} ─▶ 無料・即時。token を返す（同じ端末なら同じプレイヤー＝同じ残高）
 │ POST /api/topups {amountSats∈105/210/525} ─▶ 同額の有効な請求書があれば再利用
 │                                            ──▶ POST /api/v1/payments {out:false, amount, memo, expiry, webhook}
 │ ◀── BOLT11/QR/期限（10分）
 │ (ユーザーがウォレットで支払い)                         ──▶ webhook POST /api/webhooks/lnbits/<secret> {payment_hash}
 │        webhook / 2秒ポーリング / クライアント照会 ─▶ GET /api/v1/payments/{payment_hash} → {paid}
 │        paid → [1トランザクション] invoice PENDING→PAID（条件付きUPDATE）+ credit_ledger TOPUP +amount
 │ ◀── socket `credit` {creditSats, invoiceId, invoiceStatus:'PAID', addedSats}
 │ POST /api/zap {clientActionId}
 │        [1トランザクション] 残高確認 → エンジン ZAP → 着弾したら残高 −21（ledger ZAP）+ zaps 行（UNIQUE(player, clientActionId)）
 │ ◀── {result, creditSats, duplicate}
```

- クライアントの「支払いました」は存在しない。残高の加算は**サーバーの再照会結果のみ**。
- Webhook 本文は信用しない（`payment_hash` で自分の請求書を探すだけ）。パスの秘密値で無差別POSTを早期拒否。常に200。
- 加算は冪等：`markInvoicePaid` が PENDING→PAID を1回しか成功させない。並行Webhook・ポーラー・クライアント照会でも1回だけ。
- パンチの課金は**着弾したときだけ**。ラウンドの合間・一時停止中のタップは `ok:false` で無料。
- 再送（同じ `clientActionId`）は保存済みの結果を返し、二重課金しない（`duplicate:true`）。
- プロバイダ障害：照会失敗は `check_failures` を増やして PENDING のまま再試行。失効＋10分（`lateGraceMs`）で `EXPIRED`。

## 状態

| Invoice | 意味 | プレイヤー表示 |
|---|---|---|
| PENDING | 支払待ち | QR・期限カウントダウン・自動反映 |
| PAID | 検証済み・残高加算済み | 「+210 sats チャージ完了！」 |
| EXPIRED | 期限切れ（支払不可） | 「支払いは発生していません・もう一度」 |
| FAILED | プロバイダが失敗と応答 | 再発行導線 |

**遅延入金**：期限ぎりぎりに支払われ、サーバーが期限後に確認した場合も PAID として残高に加算する（没収しない）。
旧設計の `LATE_PAID`・繰越コード・返金ディスポジションは、残高が当日中ずっと有効になったため不要になり廃止した。

## 残高（credit）

- `players.credit_sats`（CHECK ≥ 0）と追記専用の `credit_ledger`（TOPUP / PASS / ZAP / ADJUST）。
- 残高はシーズンをまたいで繰越。シーズン中止・サーバー再起動でも失われない。
- 換金・払い戻し・送金機能はない（アプリは受け取り専用）。運営が返金する場合は会計手順で別途行い、
  必要なら `/admin` の「残高調整」（理由必須・監査ログ）で記録する。

## 配布コード（旧スポンサーパス）

管理者のみ発行（最大500枚/回、1枚あたりの sats、有効期限、ラベル）。コード `SW-XXXX-XXXX-XXXX`（約60bit）、DBにはSHA-256のみ。
1回限り（条件付きUPDATEで原子的に消費）。総当たり対策としてレート制限 20/分。Lightning のチャージを停止中でも使える。
会場で「satsを配る」運用を、ウォレットを持っていない人向けに紙のコードで代替できる。

## LNbits 本番前チェックリスト（オーナー承認後）

1. LNbits のバージョンを確認し、`POST /api/v1/payments`（`out:false`）と `GET /api/v1/payments/{payment_hash}` の応答形式を実機で確認（本実装は `payment_request`/`bolt11` 両対応、`paid` boolean を使用）。
2. 専用ウォレットを作成し **Invoice/read key** のみをサーバーの環境変数 `LNBITS_INVOICE_KEY` に設定。Admin key はサーバーに置かない。
3. `LNBITS_WEBHOOK_SECRET` をランダム生成、`SERVER_PUBLIC_URL` を HTTPS の公開URLに設定。
4. `PAYMENT_MODE=lnbits`, `ALLOW_REAL_PAYMENTS=true`。`/api/dev/mock-pay` が404になることを確認。
5. 少額（105 sats）で1件テスト → `/admin` で PAID・残高加算を確認 → パンチで減ること、期限切れ、遅延入金も確認。
6. 会場表示の文言（支払先・使途・返金方針）を運営が確定（`PAYEE_DESCRIPTION`）。

参考（実装時に最新版を再確認）：https://docs.lnbits.com/api/core/payments
