# ROADMAP / 進捗

最終更新：2026-10-28（セッション1）。凡例：✅ 完了・検証済み / 🟡 実装済み・要実機確認 / ⬜ 未着手

## Phase 0：調査・設計・環境 — ✅

- ✅ 環境確認（Node 22.22, pnpm 10.28, Chromium/Playwright 1.63, Blender なし, GPU なし）
- ✅ モノレポ、CLAUDE.md、DECISION_LOG、設計ドキュメント一式

## Phase 1：縦切りMVP — ✅（実機確認待ち 🟡）

- ✅ 決定的ルールエンジン（8地域、ATTACK/DEFEND/CHARGE、争奪・シールド・激突・必殺・KO・勝敗、リプレイ）
- ✅ サーバー：REST + Socket.IO（snapshot + seq差分、欠番再同期、時刻同期）、SQLite永続化、再起動でPAUSED復元
- ✅ 参加：予約TTL・自動均等振分・mock決済・スポンサーパス・3AP・冪等アクション
- ✅ /play（2D、日英、文字サイズ、地図/リスト、確認、二度押し防止、再接続）
- ✅ /arena（3D仮ロボット・ホログラム地図・HUD・QR・演出・2Dフォールバック・設定）
- ✅ /admin（開始/停止/緊急停止/決済停止/BOT/パス/請求書/参加者/設定/監査）
- ✅ テスト 94件 + E2E 3件、lint/typecheck/build 成功
- 🟡 実スマホ2〜3台・会場PC GPU での確認（受け入れ基準2）

## ソロ体験版 — ✅

- ✅ `apps/solo`：サーバー不要の1人用（BOT対戦）単一HTML。会場版と同じエンジン・3D演出。スマホ幅対応（コンパクトHUD・結果モーダル）
- ⬜ ソロ版のチュートリアル（最初の激突までのガイド表示）

## Phase 2：ゲームを面白く — 大部分 ✅

- ✅ 地域ボーナス・争奪・防御・充電・必殺技・カメラ演出・合成SE
- ✅ バランスシミュレーター、パラメータ探索、`mvp-2` へ調整（D-016）
- ✅ 2〜100人ダミー同時進行（シミュレーター、負荷テスト100人+観戦300）
- ⬜ 人間のプレイテストでの再調整（反応的防御の実態、3APで十分か）
- ⬜ 人数差補正オプション（D-017、デフォルトOFF）
- ⬜ BGM（権利確認済み素材 or 合成）

## Phase 3：Blenderと本格3D — 着手 🟡

- ✅ 演出リハーサルモード（`/arena?preview=1&speed=0.25`）で必殺技・KO・勝利のカメラ/VFXを目視確認し、カメラ構図とバナー位置を修正
- ✅ アートバイブル、共通スケルトン/クリップ名、GLB読込経路（欠けたクリップは procedural）、GLB検査ツール、仮GLB書き出し
- ✅ クラウドコンテナで Blender を実行（apt の Blender 4.0.2 CLI、互換確認に bpy 5.2.3 LTS）
- ✅ `tools/blender/build_robot.py`：RAIJIN / FUJIN を bpy で生成 → `.blend` 保存・GLB 書き出し・4方向プレビュー・
  `validate_robot.py` で再読込検証（パーツ別オブジェクト、共通スケルトン、剛体スキン、2048 アトラスのベイク、WebP）
- ✅ three.js 表示テスト `tools/model-viewer`（`pnpm models:test`）：GLB 読込・構造・4方向描画・手続き型クリップでの関節一致
- ✅ 手続き型アニメーションがボーン向きの異なる GLB スケルトンも正しく動かす（`robots/glbRig.ts`、ユニットテスト）
- ⬜ アリーナで Blender 版 GLB を既定にする（`apps/web/public/assets/robots/manifest.json` を置くだけ。**オーナー判断待ち**）
- ⬜ 人間アーティストによる造形の最終判断・ベイク済みアニメーション、`arena.glb`、LOD、KTX2 圧縮
- ⬜ ポストプロセス（控えめなブルーム）、必殺技専用カメラワークの強化

## Phase 4：Lightning決済と本番管理 — 実装済み・実決済未検証 🟡

- ✅ mock / LNbits アダプタ、Webhook再照会、冪等、期限切れ、遅延入金（繰越コード）、決済停止、監査ログ
- 🟡 実LNbitsでのテスト（**オーナー承認待ち**）
- ⬜ 管理者の個別アカウント・多要素認証、PostgreSQL 対応

## Phase 5：会場実装・QA — 一部

- ✅ 運営ランブック、MC実況キュー、緊急停止、負荷テストツール
- ⬜ 会場リハーサル（QR読取距離、大音量/無音、混雑Wi-Fi、長時間稼働）
- ⬜ Dockerfile / compose、HTTPS構成の実施（承認後）
- ⬜ セキュリティレビュー（外部）、アクセシビリティ監査（スクリーンリーダー）

## 次の優先タスク（次セッションはここから）

0. Blender 版ロボットの採用判断（`docs/models/MODELS.md` を確認 → 採用なら manifest.json を追加し、会場 GPU で FPS 計測）。

1. 実機確認：スマホ2〜3台 + 会場PC（GPU）で `pnpm start`、遅延と FPS を TEST_PLAN に記録。
2. 人間プレイテスト → BALANCE_REPORT と比較し `GameConfig` 再調整（DECISION_LOG に記録）。
3. 3D品質：プレビューモードで会場GPU上の見え方を確認し、必殺技VFXの強化、ブルーム（品質「高」のみ）、勝利画面の演出を追加。
4. Dockerfile + docker-compose（server/web/永続ボリューム）と DEPLOYMENT 手順の検証（公開はしない）。
5. /play のアクセシビリティ監査、iOS Safari の実機確認。
6. （承認後）LNbits テストウォレットで実決済の少額テスト。

## 既知の課題・リスク

- 3D性能は GPU 無し環境（約4fps）でしか測れていない。
- 攻撃が依然として最も強い行動（BALANCE_REPORT）。人数差の影響が大きい。
- `node:sqlite` は Node の Experimental 機能（警告を抑制して起動）。Node更新時に要確認。
- `/arena` は `/assets/robots/manifest.json` が無い場合に404をコンソールに出す（無害）。
- 演出中に次の激突が来た場合、最大4秒の遅延でキューし以降は詰める（HP表示はサーバー値に強制同期）。
