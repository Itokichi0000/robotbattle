# SATS WARS: EARTH DEFENSE（地球防衛作戦）

> **君も地球防衛軍のパイロットになろう。仲間と巨大機神を操縦して地球を守れ！**

日本のビットコインカンファレンス会場の大画面に投影し、通りがかった人がスマホで参加する **8分間の協力レイド**。
会場のみんなで雷神 RAIJIN と風神 FUJIN を共同操縦し、侵蝕体 NULL CORE から日本の8都市を守る。

- `/play` スマホ：ゲストまたは Lightning ウォレットで搭乗 → 4つの席（🎯砲撃・🛡防衛・🔌電力接続・🔧整備）から選ぶ →
  「出撃！」で数秒のミニゲーム → 大画面のロボットが動き、自分の名前が出る（表示は本人が選ぶ）。
- `/arena` 会場PC（3D, 16:9）：雷神と風神、NULL CORE と護衛、日本8都市のホログラム、攻撃の予告と残り秒数、SYNC、神雷風陣。QRを常時表示。
- `/admin` 運営（個別アカウント・役割・TOTP）：開場・開始・一時停止・終了・次の作戦と次のレイドの設定（難度・価格・定員・会場名）、緊急停止と別々の停止スイッチ、
  アナウンス、名前非表示、スポンサーパス、請求書の再照会、会場画面の表示切替、バックアップ、監査ログ、監視、リハーサル（DEMO：デモシード・敵・演出）。
- `/passport` パイロットライセンス（階級・称号・装飾・作戦の履歴・カード画像）、`/pilot/create`、`/auth/lightning` LNURL-auth、
  `/results/:raidId`（2D/3D リプレイと録画）、`/leaderboard`、`/join/:raidId`、`/demo`（オフライン体験版）。

> 現状：**DEMO_MODE（モック決済・モックログイン）でレイドが自動で回り続ける**。LNURL-auth と LNbits は実装・テスト済みだが、
> 実ウォレット・実決済での試験と本番利用はオーナー承認後。3Dはコード生成モデル（Blender の生成パイプラインと GLB 一式もあり、`?models=blender`）。
> どこまで動くかは [docs/PROGRESS.md](docs/PROGRESS.md)、未完は [docs/OPEN_ISSUES.md](docs/OPEN_ISSUES.md)、公開前の合否は [docs/RELEASE_GATE.md](docs/RELEASE_GATE.md)。
> 以前の「雷神 vs 風神」対戦ゲームは廃止（[docs/DECISION_LOG.md](docs/DECISION_LOG.md) D-032）。

## クイックスタート

前提：Node.js **22.13 以上**、pnpm 10（`corepack enable` で可）。外部DB・Docker・GPU・アカウント不要。

```bash
git clone <this repo> && cd robotbattle
pnpm install
ADMIN_PASSWORD=admin-pass-123 DEMO_MODE=true DEMO_BOTS=5 pnpm dev     # server :4000 + web :3000
```

1. 会場画面 `http://localhost:3000/arena`（F で全画面、「クリックで音声ON」）。
2. スマホ（同じLAN）で QR を読む、または `http://<PCのIP>:3000/play` → 「ゲストで搭乗」→ 席を選ぶ。
3. ロビーが終わると自動で出撃。「出撃！」→ ミニゲーム → 結果の一文と大画面のポップアップ。
4. 2人目は別ブラウザで。運営は `http://localhost:3000/admin`。
5. 8分後（またはボス撃破）に結果とMVP、30秒後に次の作戦。

有料パスの体験：`PASS_MODE=PAID` を付けて起動 → 「21 sats で出撃パス」→「テスト支払い（無料）」。
Lightning ログインの体験：`AUTH_MODE=both` → `/auth/lightning` →「テスト用ウォレットで承認」。

### サーバーなしで遊ぶ（ソロ体験版）

`pnpm solo` → `apps/solo/dist/sats-wars-solo.standalone.html` をブラウザで直接開く。同じエンジン・BOTの仲間・3D・操縦席を1ファイルに収めたオフライン版
（大画面とスマホを1ページで再現、通信・決済なし）。

## コマンド

| コマンド                                                                                 | 内容                                                                                     |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm dev`                                                                               | 開発起動（ホットリロード、`.env` を読む）                                                |
| `pnpm build` / `pnpm start`                                                              | 本番ビルド / 本番起動                                                                    |
| `pnpm test`                                                                              | ユニット・統合テスト（vitest、125件）                                                    |
| `pnpm lint` / `pnpm typecheck`                                                           | ESLint / TypeScript                                                                      |
| `pnpm e2e`                                                                               | Playwright E2E 14件（a11y 監査込み。サーバーとwebを自分で起動。既存の dev は止めてから） |
| `pnpm solo`                                                                              | オフライン体験版（単一HTML）                                                             |
| `pnpm simulate`                                                                          | バランスシミュレーション → `docs/BALANCE_REPORT.md`                                      |
| `pnpm demo:seed`                                                                         | デモシード `earth-defense-opening`（成功/失敗ルート）を再生して検証                      |
| `pnpm demo:raid --pilots 10 --success-rate 0.65 --seed 42`                               | BOT で1レイドを再生し、状態・予告・被害・SYNC・結果をログ出力                            |
| `pnpm sim:balance --runs 1000 --pilots 2,10,30,50`                                       | クリア率・所要時間・有効アクション数・役割の偏り                                         |
| `pnpm loadtest --url … --password … --pilots 50 --spectators 100` / `pnpm load:matrix …` | 負荷試験（mock のサーバーのみ）/ 2・10・30・50人の表                                     |
| `pnpm admin:user` / `pnpm db:backup` / `pnpm db:restore` / `pnpm smoke`                  | 管理アカウント作成 / DB バックアップ・復元 / 公開後のスモークテスト                      |
| `pnpm security:secrets` / `pnpm security:audit`                                          | 秘密情報スキャン / 依存の脆弱性                                                          |

`/arena` のURLオプション：`?mode=2d|3d`、`?quality=low|medium|high`、`?reduced=1`（点滅・動き抑制）、`?stats=1`（FPS）、`?models=procedural|blender`（Blender 試作モデル）、
`?preview=1`（演出リハーサル。1〜9キー、サーバーに送らない）。キー：F 全画面、S 設定、M ミュート。

## 構成

```
apps/server          Fastify + Socket.IO ゲームサーバー（SQLite: node:sqlite）、認証・出撃パス・管理
apps/web             Next.js 16（/ /play /arena /admin /auth/lightning /passport /results /leaderboard）
apps/solo            オフライン体験版
packages/shared      型・Zodスキーマ・GameConfig・都市/地図・i18n・同期ストア
packages/game-engine 決定的レイドエンジン（純粋reducer）・ミニゲーム
packages/ui          スマホ操縦席（席・ミニゲーム・HUD・結果）
packages/three-game  R3F 3D（演出ディレクター・ロボット・NULL CORE・地図・エフェクト・効果音）
tools/simulations    バランス・デモシード・負荷試験の CLI / tools/blender  Blender生成・GLB検査
tests/e2e            Playwright E2E と axe アクセシビリティ監査
docs/                設計・運用ドキュメント
```

## ドキュメント

- ルール [docs/GAME_RULES.md](docs/GAME_RULES.md) / アート [docs/ART_PIPELINE.md](docs/ART_PIPELINE.md)
- 設計 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) / API [docs/API.md](docs/API.md) / セキュリティ [docs/SECURITY.md](docs/SECURITY.md)
- 運営ランブック・起動 [docs/EVENT_RUNBOOK.md](docs/EVENT_RUNBOOK.md) / 本番設定 [docs/PRODUCTION_GUIDE.md](docs/PRODUCTION_GUIDE.md) / 公開前チェック [docs/RELEASE_GATE.md](docs/RELEASE_GATE.md)
- テスト [docs/TEST_PLAN.md](docs/TEST_PLAN.md) / バランス [docs/BALANCE_REPORT.md](docs/BALANCE_REPORT.md)・[1000回](docs/BALANCE_SIM_1000.md) / 負荷 [docs/LOAD_TEST_REPORT.md](docs/LOAD_TEST_REPORT.md)
- 進捗 [docs/PROGRESS.md](docs/PROGRESS.md) / 未完 [docs/OPEN_ISSUES.md](docs/OPEN_ISSUES.md) / 予定 [docs/ROADMAP.md](docs/ROADMAP.md) / 判断記録 [docs/DECISION_LOG.md](docs/DECISION_LOG.md)
- 開発エージェント向け [CLAUDE.md](CLAUDE.md)、元の仕様書 [SATS_WARS_EARTH_DEFENSE_CLAUDE_CODE_ALL_IN_ONE.md](SATS_WARS_EARTH_DEFENSE_CLAUDE_CODE_ALL_IN_ONE.md)

## 安全上の注意

- 既定は `PAYMENT_MODE=mock`。実決済は `PAYMENT_MODE=lnbits` と `ALLOW_REAL_PAYMENTS=true` の両方が必要で、オーナー承認が前提。
- LNbits は Invoice/read key のみ使用（アプリは送金しない）。キーはサーバーの環境変数のみ。
- **21 sats は1作戦の出撃パス**。払った額で強くならない。スポンサーパス・無料イベント・ゲストでも同じ。
  賞金・換金・払い戻し・賭け・抽選型景品はない。観戦と応援は無料。
- Lightning ログインは鍵を持っていることの確認で、本人確認ではない。秘密鍵やシードを求めることはない。
- 地図は独自の簡略作図（実際の行政境界ではありません）。素材台帳：[assets/LICENSES.md](assets/LICENSES.md)。
