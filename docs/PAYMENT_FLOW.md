# PAYMENT_FLOW — Lightning 決済

> **既定は `PAYMENT_MODE=mock`（実際の sats は動かない）。**
> `PAYMENT_MODE=lnbits` はオーナーの明示承認のうえ `ALLOW_REAL_PAYMENTS=true` を設定しない限りサーバーが起動を拒否する。
> 本物の資金を使うテストはオーナー承認時のみ実施する。

## フロー

```
/play           server                           provider (mock | LNbits)
 │ reserve ───▶ 試合受付可? 振分(少ない側) 予約TTL 3分
 │ invoice ───▶ 期限=min(2分, 受付終了-30秒) ───▶ POST /api/v1/payments {out:false, amount, memo, expiry, webhook}
 │ ◀── BOLT11/QR/期限                                    
 │ (ユーザーがウォレットで支払い)                       ──▶ webhook POST /api/webhooks/lnbits/<secret> {payment_hash}
 │                webhook / 2秒ポーリング / クライアント照会 ─▶ GET /api/v1/payments/{payment_hash} → {paid}
 │                paid → [1トランザクション] invoice=PAID, participant=ACTIVE, reservation=CONFIRMED, ADD_PARTICIPANT(3AP)
 │ ◀── paymentStatus (socket) / /api/me
```

- クライアントの「支払いました」は存在しない。権限付与は**サーバーの再照会結果のみ**。
- Webhook 本文は信用しない（`payment_hash` で自分の請求書を探すだけ）。パスの秘密値で無差別POSTを早期拒否。常に200。
- 付与は冪等：`invoice.status` が `PAID/LATE_PAID` なら何もしない。同期処理のため並行Webhook・ポーラー・クライアント照会でも1回だけ。
- プロバイダ障害：照会失敗は `check_failures` を増やして PENDING のまま再試行。失効+10分で `EXPIRED`。

## 状態

| Invoice | 意味 | プレイヤー表示 |
|---|---|---|
| PENDING | 支払待ち | QR・期限カウントダウン・確認中 |
| PAID | 検証済み・AP付与済み | コントローラーへ |
| EXPIRED | 期限切れ（支払不可） | 「新しい請求書を発行」 |
| FAILED | プロバイダが失敗と応答 | 再発行導線 |
| LATE_PAID | 支払確認時に試合が受付不可（終了/中止等） | 「没収しません。運営が対応」→ 繰越コード表示 |

予約が期限切れでも、試合が受付可能な間に支払が確認されれば参加させる（料金を取って参加不可にしない）。

## 遅延入金・補填

`/admin` の「要確認の請求書」から：
- **繰越コード発行（CARRY_OVER）**：7日有効の1回用パスを発行し、本人の `/play` に表示。
- **返金対応（REFUND_REQUESTED）**：アプリは送金しない。運営の会計手順で返金し、メモを記録。
- **解決済（RESOLVED）**。
すべて監査ログに残る。

## スポンサーパス

管理者のみ発行（件数上限200/回、有効期限、ラベル、試合限定可）。コード `SW-XXXX-XXXX-XXXX`（約60bit）、DBにはSHA-256のみ。
1回限り（条件付きUPDATEで原子的に消費）。総当たり対策としてレート制限 20/分。

## LNbits 本番前チェックリスト（オーナー承認後）

1. LNbits のバージョンを確認し、`POST /api/v1/payments`（`out:false`）と `GET /api/v1/payments/{payment_hash}` の応答形式を実機で確認（本実装は `payment_request`/`bolt11` 両対応、`paid` boolean を使用）。
2. 専用ウォレットを作成し **Invoice/read key** のみをサーバーの環境変数 `LNBITS_INVOICE_KEY` に設定。Admin key はサーバーに置かない。
3. `LNBITS_WEBHOOK_SECRET` をランダム生成、`SERVER_PUBLIC_URL` を HTTPS の公開URLに設定。
4. `PAYMENT_MODE=lnbits`, `ALLOW_REAL_PAYMENTS=true`。`/api/dev/mock-pay` が404になることを確認。
5. 少額で1件テスト → `/admin` で PAID・AP付与を確認 → 期限切れ・遅延入金ケースも確認。
6. 会場表示の文言（支払先・使途・返金方針）を運営が確定。

参考（実装時に最新版を再確認）：https://docs.lnbits.com/api/core/payments
