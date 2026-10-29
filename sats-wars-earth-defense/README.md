# SATS WARS: EARTH DEFENSE

**ONE MECH. EIGHT PILOTS. DEFEND JAPAN.** — 8人の力で、日本を守れ。

ビットコイン関連カンファレンス向けの参加型3Dブラウザゲーム。会場の大画面に巨大メカ **RAIJIN-01（雷神）** と侵略体
**NULL SWARM / NULL CORE** の戦闘がリアルタイム3Dで映り、来場者はスマホで機体の一部（8席・4役割）に搭乗して協力し、
日本の都市を守ります。仕様の正本は [`CLAUDE.md`](CLAUDE.md)（オーナー提供 BUILD DIRECTIVE v1.0）。

> 現在の到達点：**Phase 0（基盤）と Phase 1（2台のスマホで1機を動かす縦切り）**。3D は「仮モデル」と画面に明示しています。
> 進捗と次の作業は [`docs/00_execution_plan.md`](docs/00_execution_plan.md) と [`NEXT_ACTIONS.md`](NEXT_ACTIONS.md)。

## すぐに動かす（鍵・外部サービス不要の sandbox）

```bash
pnpm install
```

```bash
OPERATOR_PASSWORD=change-me-rehearsal pnpm dev
```

起動ログに URL が出ます（1つのオリジン・ポート 4400 にすべて載ります）。

| 画面           | URL                               | 使う人                                         |
| -------------- | --------------------------------- | ---------------------------------------------- |
| 大画面         | `http://localhost:4400/display/`  | 会場のプロジェクター/モニター（GPU のある PC） |
| パイロット     | `http://<LANのIP>:4400/pilot/`    | 来場者のスマホ（大画面の QR から開く）         |
| 運営           | `http://localhost:4400/operator/` | スタッフ（`OPERATOR_PASSWORD`）                |
| ヘルスチェック | `http://localhost:4400/health`    | 監視                                           |

- `OPERATOR_PASSWORD` を省くと起動のたびにランダムなパスワードを生成してログに表示します（開発時のみ。本番は必須）。
- スマホは PC と同じ Wi-Fi に接続し、大画面の QR を読み取ります。QR の URL は `PUBLIC_BASE_URL`（未設定なら LAN の IP を推測）。
- 大画面はキー `F` でフルスクリーン、最初のクリック/キーで音声を有効化（キオスク運用は `docs/04_conference_runbook.md`）。

### 遊び方（Phase 1）

1. 大画面の QR → スマホで `DEMO GUEST で搭乗`（テスト用・無料。本番認証ではないと画面に明示）。
2. 席を選ぶ：**砲撃 左 / 砲撃 右 / 防衛 左 / 防衛 右**（電力・整備の4席は Phase 2 まで AUTO SUPPORT が担当）。
3. `READY` → 運営画面で `START` → 出撃演出（約8秒、`SKIP DEPLOY` 可）→ WAVE 1 → WAVE 2 → BOSS（NULL CORE）。
4. 砲撃：敵をタップか `LOCK ON` → チャージ → `FIRE`。攻撃予告中の敵を先に倒すとその攻撃は消える。
   右腕レールガン（GUNNER R）のロックは弱点を露出させ、全砲撃の威力が上がる。
5. 防衛：担当2方向（左席＝前方/左側、右席＝右側/後方）の攻撃予告を見て、着弾直前に `シールド展開`。1.2秒以内で PERFECT。
6. 異なる役割の成功が10秒以内にそろうと **TEAM SYNC** が上がる（`LINK ESTABLISHED`）。

## コマンド

```bash
pnpm dev          # 開発サーバー（server + 3アプリの Vite を同一プロセス・同一オリジンで）
pnpm test         # ユニット + Socket.IO 統合テスト（vitest）
pnpm lint         # ESLint（警告0）
pnpm typecheck    # tsc --noEmit
pnpm format:check # Prettier
pnpm build        # server を esbuild、3アプリを vite build
pnpm start        # 本番起動（apps/server/dist + apps/*/dist を配信）
pnpm e2e          # Playwright：本番ビルドで大画面 + スマホ2台 + 運営の縦切り（先に pnpm build）
```

画面キャプチャ（ドキュメント用）：`OPERATOR_PASSWORD=... node tools/perf/capture-phase1.mjs http://localhost:4400 docs/qa/phase1`

## 構成

```
apps/server      Fastify 5 + Socket.IO 4。権威サーバー（20Hz シミュレーション、10Hz スナップショット）、SQLite、セッション、運営
apps/display     大画面：React + React Three Fiber。仮 RAIJIN・敵・格納庫・東京湾・日本ホログラム・VFX・カメラ・HUD（ref 05）
apps/pilot       スマホ：React。参加 → 席選択 → READY → 役割コンソール（ref 06）→ デブリーフ
apps/operator    運営：React。進行・AUTO SUPPORT・席・画質/音量・接続/FPS・監査ログ
packages/shared       席・役割・フェーズ・都市/日本地図・GameConfig/プリセット・状態/イベント/Socket 契約・Zod（サーバー専用）
packages/game-engine  決定的ルール（純粋関数 reduce / advanceTo）、ヒント、BOT、ヘッドレス対戦
packages/client       クライアント共通ストア（スナップショット + イベント）、React フック
packages/ui-tokens    色・フォント・アイコン（SVG）・フレーム
tests/e2e        Playwright
tools/perf       キャプチャ/スクリーンショット
tools/blender    （Phase 5）Blender パイプライン
docs/            計画・アセット台帳・プロトコル・認証決済・運用・QA・決定ログ
references/      オーナー提供の参考画像6点（ゲームには組み込まない）
```

## 安全と運営の確認事項（必読）

- **実決済は未実装・無効**。`APP_MODE=live` はサーバーが起動を拒否します（Phase 3/4 の実装とオーナーの明示承認が必要）。
  sandbox では架空のお金も含めて決済画面は出ません（共有エネルギーパルスは Phase 4）。
- **パイロット認証は無料**。秘密鍵・シードフレーズ・本名・メールを一切求めません。Phase 1 のログインは `DEMO GUEST`（テスト用）のみで、
  画面に「本番認証ではありません」と明記しています。Lightning ウォレット認証（LNURL-auth）は Phase 3。
- 公開画面に出る名前は `PILOT-XXXX`（ランダム）だけ。公開スナップショットに内部 ID・鍵は含みません（テストで検査）。
- 課金額ランキング・賞金・抽選は作りません。勝敗は役割の協力で決まり、払わなくても最後まで遊べます。
- 会場での利用規約、送金の扱い（返金可否・受取先表示）、表示名の公開範囲は**運営者が事前に確認**してください（Phase 4 で決済を有効化する前の必須事項）。
- 本番（`NODE_ENV=production`）は `OPERATOR_PASSWORD`（12文字以上）と https の `PUBLIC_BASE_URL` がないと起動しません。厳格な CSP・HSTS・
  HttpOnly/SameSite Cookie・Origin 検査（CSRF）・レート制限を有効にします。

## ライセンスと素材

3D はすべてコードで生成したオリジナル（外部 3D 素材は未採用）、効果音は Web Audio で合成、フォント Chakra Petch は OFL-1.1。
詳細は [`docs/01_asset_register.md`](docs/01_asset_register.md)。
