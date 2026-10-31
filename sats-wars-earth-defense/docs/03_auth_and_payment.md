# 03 — Auth and payment / 認証と決済

**現状（2026-10-30）**：LNURL-auth（LUD-04）によるパイロット認証と、共有エネルギーパルス（sandbox の VIRTUAL 決済 +
LNbits による実決済アダプター）を実装済み。**実決済はオーナーの明示承認があるまで有効化しない**（LNbits のキーも公開ドメインも
未設定なので、このリポジトリの既定構成では実際のお金は一切動かない）。実ウォレット・実決済での試験は未実施（後述）。

## セッションと共通の安全策

- パイロットセッション：ランダム 32 バイトのトークンを `sw_pilot` Cookie（HttpOnly・SameSite=Lax・https では Secure）に入れ、
  DB には SHA-256 のみ保存。期限 3 日。運営は `sw_operator`（SameSite=Strict、14 時間）。
- 公開名は既定 `PILOT-XXXX`（ランダム 4 桁 16 進。鍵や ID から作らない）。コールサインは任意（2〜12 文字、NFKC 正規化、
  文字・数字・`-`・`_` のみ）で、本人が「大画面に表示する」を選んだときだけ大画面に出る。運営は一括で隠せる（HIDE CALLSIGNS）。
- 公開スナップショットに内部 ID・linkingKey・支払い情報を含めない（E2E とサーバー統合テストで検査）。
- Cookie を伴う変更系 HTTP は `Origin` 検査（CSRF）。ソケットのハンドシェイクも同様。レート制限あり。
- ログはクエリ文字列を落とす（k1・sig・key・webhook トークンがログに残らない。テストで検査）。

## LNURL-auth（LUD-04）— パイロット認証（無料・送金なし）

一次仕様：https://github.com/lnurl/luds/blob/luds/04.md 実装：`apps/server/src/lnurl.ts`、`routes/auth.ts`、`apps/pilot/src/screens/Join.tsx`。

1. スマホで「Lightningウォレットで認証」→ `POST /api/auth/attempt`。サーバーは `k1`（32 バイト CSPRNG）と試行 ID を作り、
   **このブラウザだけ**に紐づける乱数トークンを `sw_auth` Cookie（HttpOnly）で渡す（DB には SHA-256 のみ）。期限 5 分・1回限り。
   応答：`attemptId` `lnurl`（LUD-01 bech32 大文字）`callbackUrl` `expiresAt` `qrSvg`（`LIGHTNING:<lnurl>`）。
2. 同じスマホのウォレットを `lightning:` リンクで開く／リンクをコピー／別端末用の個人 QR（大画面には出さない）。
3. ウォレットがドメイン固有の linkingKey で k1 に署名し `GET /api/auth/lnurl?tag=login&k1&sig=<DER hex>&key=<33byte 圧縮公開鍵 hex>`。
   サーバーは 入力形式 → k1（存在・未使用・期限内）→ secp256k1 署名（`@noble/curves`、prehash なし、high-S も受理）を検証し、
   `sha256('lnurl:'+key)` から仮名パイロットを作成/再利用 → `{"status":"OK"}`。失敗は `{"status":"ERROR","reason":…}`。
   不正な署名はその試行を焼き捨てる（同じ k1 で総当たりさせない）。
4. スマホは `GET /api/auth/attempt/:id/status` をポーリング（インターバル＋ウォレットから戻った `visibilitychange`/`focus`）。
   `sw_auth` を持つブラウザだけが `AUTHORIZED` を受け取り `sw_pilot` を得る。他人の試行 ID を知っていても横取りできない。
5. **一つのウォレット＝一台のスマホ**：同じ鍵で別端末からログインすると古いセッションを失効させ、古い端末には
   `pilot:notice SESSION_REPLACED`。席は同じパイロットのまま新しい端末に引き継がれ、同じ試合での二重席占有は起きない。
6. 拒否（テストで固定）：k1 再利用・期限切れ・署名なし/改ざん・鍵の差し替え・不正形式・未知の k1・別ブラウザからの claim。
7. 文言：「パイロット認証（無料）」「LNURL-auth・無料・支払いは発生しません」「署名で鍵を持っていることだけを確認します
   （本人確認ではありません）」。秘密鍵・シードフレーズ・本名・メールは一切求めない（入力欄もない）。原因別の再試行
   （期限切れ／署名を確認できない＝非対応ウォレットの可能性／通信不可）。支払えばログインできると誘導しない。
8. DEMO GUEST は sandbox の既定、または `DEMO_GUEST_ENABLED=true` のときだけ。画面に「テスト用・無料・本番認証ではありません」。

**テスト用ウォレット**：`apps/server/src/testWallet.ts`（LUD-04 と同じ署名をする最小ウォレット。資金を持たず、ログイン署名だけ）。
リハーサルでは `pnpm --filter @swed/server lnurl-wallet <LNURL...> [合言葉]` で承認できる。E2E と capture スクリプトもこれを使う。

## 共有エネルギーパルス（Lightning 決済）

実装：`apps/server/src/payments/{provider,sandbox,lnbits,service}.ts`、`routes/payments.ts`、`apps/pilot/src/screens/PulseSheet.tsx`、
運営画面の SHARED ENERGY パネル。一次仕様（参考）：https://github.com/lnurl/luds/blob/luds/06.md

- 意味（D-032）：sats の役割は1つだけ。**炉心停止（ブラックアウト）の間だけ、固定 21 sats で炉心を即時復旧し、雷神ゲージ +20%**
  （`PULSE_AMOUNT_SATS` と GameConfig `crisis.recoverGauge`）。電力B が回路をつないでも同じ効果なので、払っても強くはならない。
  **炉心停止中でなければ請求書を作らない**（`NO_CRISIS`）。1人 30 秒に1回・1試合最大3回・1試合合計24回・未払いの請求は1人1件まで。
  支払いなしでも勝てる（BOT シミュレーションと E2E の 8 席ソーティーは支払いゼロで最後まで進む）。課金額ランキング・賞金・抽選は存在しない。
- 導線：炉心停止のときに全員のスマホに出る赤い帯の「21 sats で即時復旧」→ シート。請求書を作る前に **金額・受取先・種類（実際の支払い／VIRTUAL）・
  この作戦の残り回数・返金できない場合があること** を表示 → 明示ボタン → `POST /api/payments/intent` → BOLT11（live）または
  VIRTUAL 表示（sandbox）。live の支払い QR は琥珀の枠で、無料の認証 QR と見た目を分ける。
- 確定：サーバーが **バックエンドへ再照会して settled を確認**（Webhook はきっかけ、3 秒ごとのポーリングでも拾う）→
  DB の状態遷移（`pending → settled`、`payment_hash` UNIQUE）を条件に1回だけ → エンジンに `SATS_PULSE`（`intentId` で冪等）→
  `sats_pulse_settled` を全員に配信（大画面：空から炉心へ雷、「LIGHTNING 着金 · 炉心復旧 · 雷神ゲージ +20%」。
  **誰が払ったか・金額は表示しない**）。同時・重複 Webhook でも1回（テストで固定）。
- 試合終了後に settled になった支払い：次ラウンドへ繰り越さず `applied='unapplied'` として記録・監査ログ・運営画面に表示し、
  運営が個別に対応する（仕様 §8.4）。スマホにも「今回は反映されませんでした。運営が対応します」と出す。
- pending / settled / expired（期限 180 秒）を表示。バックエンド障害は `BACKEND_UNAVAILABLE` で断るだけで、試合は止まらない。
- 自分の intent しか見られない（`GET /api/payments/intent/:id` はパイロット本人のみ）。preimage・キーはブラウザに渡さない。

### 支払いの見せ場：炉心停止（REACTOR BLACKOUT）（D-025〜D-032）

- WAVE 2 と BOSS の途中で炉心が停止する（全レーンの回復が予備電源の 30% に落ちる、25 秒。D-031）。大画面は暗くなり赤い非常灯が回り、
  中央に「炉心停止」と残り秒数、**番号付きの2つの直し方**（① 電力B がスマホで回路をつなぐ ② 誰かがスマホから 21 sats を送る）と
  「どちらでも復旧すると雷神ゲージ +20%」を表示。運営画面の「炉心停止を起こす」で、展示中いつでも起こせる（その幕の予定分の代わり）。
- スマホには全員に赤い帯が出て、「21 sats で即時復旧（任意 — 払わなくても仲間が直せます）」のボタン。押すと
  いつもの条件シート（金額・受取先・種類・返金の注意）が開き、確認してから請求書を作る。勝手にウォレットは開かない。
- 電力B のスマホには炉心回路のパズルが自動で開く。解けば復旧（電力B が空席なら AUTO SUPPORT が 15 秒後に復旧）。
- 支払いが確定すると、空から胸部炉心に雷が落ち、「LIGHTNING 着金 — 請求から着金まで X.X 秒 · 炉心復旧 · 雷神ゲージ +20%」。
  VIRTUAL では秒数を出さず VIRTUAL と表示。払った人・金額は出さない。電力B の修復でも同じ雷神ゲージ +20%（AUTO の復旧は加算なし）。
  支払いの確認中に仲間が先に直した場合も、確定した支払いの分のゲージは加算する（払ったのに何も起きない、を作らない）。
- sandbox のデモでは、運営画面の「VIRTUAL を自動確定」を ON にすると約1.5秒で確定する（既定 OFF、お金は動かない）。

### アダプター（仕様 §8.4 `PaymentProvider`）

| provider                 | 使うとき           | 中身                                                                                                                                                                                                                          |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SandboxPaymentProvider` | `APP_MODE=sandbox` | 架空の請求書（`paymentRequest` なし）。**運営画面の SETTLE でのみ確定**。画面は常に VIRTUAL。live のふりをしない。                                                                                                            |
| `LnbitsPaymentProvider`  | `APP_MODE=live`    | `POST /api/v1/payments {out:false, amount, memo, expiry, webhook}` で請求書作成、`GET /api/v1/payments/{hash}` で確認、`GET /api/v1/wallet` で疎通確認。**Invoice/read key のみ**。送金（`out:true`）・Admin key は使わない。 |

Webhook：`POST /api/payments/webhook/lnbits?token=<LNBITS_WEBHOOK_SECRET>`（定数時間比較。不一致は 403）。到達確認用に
`GET /api/payments/webhook/lnbits/ping?token=…`。Webhook の内容は信用せず、必ず LNbits に再照会してから反映する。

### LIVE 化の手順（オーナーの明示承認が前提）

起動時から LIVE にはならない。サーバーが `APP_MODE=live` で起動しても、パルスは **停止中（LIVE OFF）** から始まる。

1. オーナーが受取先（LNbits ウォレット）・金額・注意書き・返金対応・公開ドメインを承認する。
2. サーバー環境変数：`APP_MODE=live` `PUBLIC_BASE_URL=https://…` `LNBITS_URL=https://…` `LNBITS_INVOICE_KEY=<invoice/read key>`
   `PAYMENT_RECIPIENT_LABEL=<支払う人に見せる受取先名>`（任意で `PULSE_AMOUNT_SATS` `LNBITS_WEBHOOK_SECRET`）。
   どれかが欠けるとサーバーは起動を拒否する。本番（`NODE_ENV=production`）では LNbits も https 必須。
3. 運営画面 SHARED ENERGY → **RUN CHECKS**：LNbits に invoice key で到達できるか、公開 Webhook URL が外から答えるかを検査。
4. 両方 PASS（10 分以内）なら、確認欄に `LIVE` と入力 → **LIVE ON**（受取先と金額の確認ダイアログあり）。監査ログに残る。
5. 停止はいつでも **LIVE OFF** の1クリック。停止中もゲームは DEMO として最後まで遊べる。

## 未実施（環境・承認が必要）

- **実ウォレットでの LNURL-auth 試験**（2 種類以上）：ウォレットは https の公開ドメインにしか接続できないため、このコンテナでは
  不可能。テスト用ウォレットでの署名検証・E2E は実施済み。対応状況の記録は公開ドメインを用意した後に行う。
- **実決済の試験**：LNbits の受取先・キー・公開ドメイン・オーナー承認がそろってから、少額で実施する。LNbits API との結合は
  フェイク fetch による統合テストのみ（実サーバーには一度も接続していない）。

## 承認が必要なこと

- 実決済（LIVE）の有効化、受取先ウォレット/LNbits の用意、少額の実地試験。
- 公開ドメイン・TLS・デプロイ（ウォレットからの LNURL-auth コールバックと Webhook の到達に必要）。
- 実機ウォレットでの LNURL-auth 試験の実施判断。
