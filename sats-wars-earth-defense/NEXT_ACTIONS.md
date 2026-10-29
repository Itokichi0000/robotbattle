# NEXT ACTIONS

未完了・外部依存・未確認ライセンスの一覧（仕様 §17-6）。上から順に着手する。

## Phase 2 — 8席とゲームループ（次）

- [ ] 電力A（POWER_CORE）：配分スライダー（武器/防衛/機動/修理 = 100%）。`distributionVersion` で取り合いを解決（古い版の送信は拒否）。
      大画面：胸部から腕/肩への回路発光（`power_routed`）。
- [ ] 電力B（POWER_ROUTER）：過負荷イベントで切れる送電経路の再接続パズル（単純連打にしない）。切断中はそのレーンの回復が止まる。
- [ ] 整備A（脚・肩関節）/ 整備B（コア・両腕砲）：故障部位の選択 → 修理操作 → 回復 25（8秒冷却・修理エネルギー 10）。
      部位HPの効果：腕＝砲撃威力、肩＝盾の遮断率、脚＝機動（回避）、コア＝エネルギー回復。
- [ ] RAIJIN OVERDRIVE：BOSS 中に SYNC≥80 & CAPACITOR≥100 で `OVERDRIVE READY` → 4系統から1人ずつ `SYNC NOW`（5秒）→ 不足席は明示 AUTO SUPPORT が代理 →
      `overdrive_fired` を1回だけ（ボスへ 300）。大画面 3〜5 秒の収束演出・HUD を薄く。
- [ ] コンボ：4系統の成功で `+15 SYNC`。シーケンス順は自由（固定順にしない）。
- [ ] 席の開放（`openSeats` を全8席に）、AUTO SUPPORT の電力・整備ロジックを人間用ルールに合わせる。
- [ ] 運営：FORCE DISCONNECT、デモ再生（BOT が全席を操作する展示用ループ）、SHORT/STANDARD のバランス再確認（`balance.test.ts` を8席に拡張）。
- [ ] 8席 E2E（BOT ソケット 6 + Playwright スマホ 2）と負荷試験（8人 + 大画面2 + 運営）。

## Phase 3 — LNURL-auth

- [ ] `docs/03_auth_and_payment.md` の手順で実装。`@noble/curves` で secp256k1 検証、k1 単回使用・期限・別試行拒否のテスト。
- [ ] 実ウォレット2種類以上での実機試験（端末がない場合は未実施と明記）。**公開 https ドメインが必要**（オーナー承認）。

## Phase 4 — 共有エネルギーパルス

- [ ] Sandbox provider（VIRTUAL 表示、運営画面でのみ確定）、固定 21 sats / +20、30秒・3回の上限、重複 Webhook の冪等性テスト。
- [ ] Live adapter（LNbits invoice/read key のみ）。**実決済の有効化はオーナーの明示承認後**。

## Phase 5 — 映像

- [ ] Blender（CLI）をインストールし `tools/blender/` に RAIJIN-01・NULL CORE の生成スクリプト（部位別・関節名維持・PBR/発光別材質・GLB 出力・プレビュー描画）。
      このコンテナには Blender が無い（未実行）。
- [ ] glTF Transform で最適化（KTX2/Meshopt）、主役 50k〜120k 三角形で実機フレーム時間を計測。
- [ ] 90秒ボス戦を最優先で仕上げ（カメラ `finisher`、`impactClose`、`japanTactical`、装甲破損・煙・修理発光）。
- [ ] CC0 素材（Poly Haven HDRI、Kenney、Quaternius）を使う場合は入手時にライセンスを `docs/01_asset_register.md` に記録。
- [ ] Meshy 等の有料 AI 生成は**オーナー承認後のみ**。

## Phase 6 — 会場 QA

- [ ] 会場 GPU PC で 1920×1080 の FPS 実測（このコンテナは SwiftShader で約 1〜5 FPS。会場性能は未計測）。
- [ ] iPhone Safari / Android Chrome 実機（ノッチ・回転・スリープ復帰・ウォレット往復）。
- [ ] 通信断・途中参加・途中退出・二重支払い Webhook のリハーサル、キオスク、バックアップ映像、機能凍結。

## 既知の制約・未確認

- 3D は仮モデル（コード生成）。参考画像 01〜03 の質感には未到達（Phase 5）。
- 日本語フォントは端末依存（同梱なし）。
- `node:sqlite` は Node 22 で ExperimentalWarning を出す（動作に影響なし）。
- ルートの旧実装（雷神＋風神）は参照用に残置。新プロジェクトからは依存しない。
