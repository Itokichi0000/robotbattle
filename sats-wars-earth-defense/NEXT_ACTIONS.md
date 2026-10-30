# NEXT ACTIONS

未完了・外部依存・未確認ライセンスの一覧（仕様 §17-6）。上から順に着手する。Phase 0〜4 の実装と自動 QA は完了（2026-10-30）。

## オーナーの承認・用意が必要なもの（ここが止まると先に進めない）

- [ ] **公開 https ドメイン + デプロイ**（承認制）：ウォレットは https の公開 URL にしか LNURL-auth のコールバックを送れない。
      LNbits の Webhook も同じ。決まったら `PUBLIC_BASE_URL`・`TRUST_PROXY`・`ALLOWED_ORIGINS` を設定。
- [ ] **実ウォレットでの LNURL-auth 試験**（2種類以上。例：Phoenix 以外の LNURL-auth 対応ウォレット、Breez、Zeus、Alby など、
      会場で想定するもの）：対応状況を `docs/03_auth_and_payment.md` に記録。未対応ウォレットの案内文も確認。
- [ ] **実決済（LIVE）の承認**：受取先（LNbits ウォレット）・金額・注意書き・返金対応の決定 → `LNBITS_URL`/`LNBITS_INVOICE_KEY`
      （invoice/read key のみ）/`PAYMENT_RECIPIENT_LABEL` を設定 → 運営画面で RUN CHECKS → `LIVE` 入力 → 少額で実地試験
      （請求書作成・支払い・Webhook・再照会・1回だけ反映・期限切れ・試合終了後の unapplied）。LNbits 実サーバーとは未結合（フェイク fetch のみ）。
- [ ] 会場の利用規約・送金の扱い（返金可否）・表示名の公開範囲の確認（運営者）。

## Phase 5 — 映像（オーナー指示で後回し中）

- [ ] Blender（CLI）をインストールし `tools/blender/` に RAIJIN-01・NULL CORE の生成スクリプト（部位別・関節名維持・PBR/発光別材質・GLB 出力・プレビュー描画）。
      このコンテナには Blender が無い（未実行）。
- [ ] glTF Transform で最適化（KTX2/Meshopt）、主役 50k〜120k 三角形で実機フレーム時間を計測。
- [ ] 90秒ボス戦を最優先で仕上げ（`impactClose`・`japanTactical` カット、装甲破損・煙・修理発光、OVERDRIVE の雷撃をメッシュ/シェーダーで）。
- [ ] CC0 素材（Poly Haven HDRI、Kenney、Quaternius）を使う場合は入手時にライセンスを `docs/01_asset_register.md` に記録。
- [ ] Meshy 等の有料 AI 生成・有料素材は**オーナー承認後のみ**。

## Phase 6 — 会場 QA（実機が必要なもの）

- [ ] 会場 GPU PC で 1920×1080 の FPS 実測（このコンテナは SwiftShader で約 1〜5 FPS。会場性能は未計測）。
- [ ] iPhone Safari / Android Chrome 実機 8 台（ノッチ・回転・スリープ復帰・ウォレットアプリ往復・触覚）。
- [ ] 会場 Wi-Fi での負荷（`pnpm --filter @swed/server loadtest`）、通信断・途中参加・途中退出・二重支払い Webhook のリハーサル。
- [ ] キオスク起動の固定、バックアップ映像の録画、機能凍結（本番24時間前）。

## 改善候補（必須ではない）

- [ ] 電力 B のパズルを難易度別（4×4、分岐タイル）に。（整備のボルトは「なぞって回して締める」操作に変更済み、D-030）
- [ ] REACTOR BLACKOUT の頻度・長さ（`crisis.atMs` / `durationMs`）を実プレイで調整。人の電力 B が放置したときの 25 秒は長すぎないか。
- [ ] GRID PULSE の「請求から着金まで X 秒」は支払う人のウォレット操作時間を含む。実決済の試験で見え方を確認。
- [ ] OVERDRIVE の SYNC NOW をスマホ同士のタイミング合わせ（同時押しボーナス）に。
- [ ] 運営画面に試合ログの CSV 出力（チーム協調指数の集計）。

## 既知の制約・未確認

- 3D は仮モデル（コード生成）。参考画像 01〜03 の質感には未到達（Phase 5）。
- 日本語フォントは端末依存（同梱なし）。
- `node:sqlite` は Node 22 で ExperimentalWarning を出す（動作に影響なし）。
- テスト用ウォレット（`apps/server/src/testWallet.ts`）の鍵導出は LUD-05 ではなく簡易版（テスト専用。実ウォレットは LUD-05 で導出）。
- ルートの旧実装（雷神＋風神）は参照用に残置。新プロジェクトからは依存しない。
