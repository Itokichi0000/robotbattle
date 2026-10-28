# SATS WARS — 雷神 vs 風神

日本のビットコインカンファレンス会場の一角で大画面に投影し、**通りがかった人がその場で遊ぶ**ための3Dロボットバトル「ZAP BATTLE」。

> **応援するロボットを選んで、satsを送るとパンチ！ 先にHPを0にしたチームがその地方をゲット。**

- `/play` スマホ：①雷神か風神を選ぶ（無料・即時）②1回チャージ（105/210/525 sats、デモではモック、または配布コード）③タップでパンチ（1発21 sats）
- `/arena` 会場PC（3D, 1920×1080）：殴り合う雷神と風神、パンチした人の名前が1秒以内にポップアップ、必殺技・KO演出、8地方の塗り分け、遊び方3ステップ＋QRを常時表示
- `/admin` 運営：自動ループ/一時停止/緊急停止/チャージ停止/デモBOT/配布コード/残高調整/監査ログ
- `/` 案内＋ライブ状況、`/results/:matchId` シーズン結果

> 現状：**デモモード（実決済なし）でシーズンが自動で回り続ける**。実決済（LNbits）は実装・テスト済みだが、
> 本番利用はオーナー承認後（docs/PAYMENT_FLOW.md）。3Dロボットはコード生成の仮モデル（GLB差し替え対応）。
> ルールは2026-10-28のオーナー指示で初版（陣取り＋AP）から作り直した（docs/DECISION_LOG.md D-023）。

## クイックスタート（第三者向け）

前提：Node.js **22.13 以上**、pnpm 10（`corepack enable` で可）。外部DB・Docker不要。

```bash
git clone <this repo> && cd robotbattle
pnpm install
cp .env.example .env                # 任意。ADMIN_PASSWORD を設定（未設定なら起動ログに一時パスワードを表示）
pnpm dev                            # server :4000 + web :3000
```

### デモで遊ぶ

1. `pnpm dev` の時点でシーズンが自動で始まり、8ラウンドごとに自動で次のシーズンへ進む。
2. `http://localhost:3000/arena`（会場PCなら全画面 F キー）。「クリックで音声ON」を押す。
3. スマホ（同じLAN）で QR を読む、または `http://<PCのIP>:3000/play` → 雷神/風神を選ぶ → 「チャージ」→ 210 sats →
   「テスト支払い（模擬）」→ ラウンド中にパンチボタンを連打。大画面に自分の名前が出る。
4. 人がいないときは `/admin`（パスワードでログイン）の「デモBOT」を各チーム 4 などに。

BOT付きで起動：`DEMO_BOTS_PER_TEAM=4 pnpm dev`（または `DEMO_AUTOPILOT=true` で各チーム4体）。開幕演出を短く：`OPENING_MS=3000`。

### サーバーなしで遊ぶ（ソロ体験版）

`pnpm solo` → `apps/solo/dist/sats-wars-solo.standalone.html` をブラウザで直接開くだけで遊べます。
ゲームエンジン・BOT観客・3Dアリーナをすべて1ファイルに収めたオフライン版です。会場の「大画面」と「あなたのスマホ」を1ページで再現します（通信・決済なし、体験用に210 satsを配布）。

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発起動（ホットリロード） |
| `pnpm build` / `pnpm start` | 本番ビルド / 本番起動 |
| `pnpm test` | ユニット・統合テスト（vitest、約80件） |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm e2e` | Playwright E2E（サーバーを自動起動。既存の dev は停止してから） |
| `pnpm solo` | オフライン1人用体験版（単一HTML）をビルド |
| `pnpm simulate` | バランスシミュレーション → `docs/BALANCE_REPORT.md` |
| `pnpm --filter @sats-wars/three-game export-glb` | 仮ロボットをGLB書き出し（GLB読込経路の確認用） |

`/arena` のURLオプション：`?mode=2d`（2D表示）、`?quality=low|medium|high`、`?reduced=1`（点滅・動き抑制）、`?stats=1`（FPS）、`?models=procedural`。
キー：F フルスクリーン、S 表示設定、M ミュート。演出リハーサル：`/arena?preview=1&speed=0.25`（1〜8キーでラウンド開始・連打・必殺・KO・全国制覇等を再生、シーズンに影響なし）。

## 構成

```
apps/server         Fastify + Socket.IO ゲームサーバー（SQLite: node:sqlite）
apps/web            Next.js 16（/ /play /arena /admin /results）
packages/shared     型・Zodスキーマ・GameConfig・地図・i18n・同期ストア
packages/game-engine 決定的ルールエンジン（純粋reducer）
packages/three-game  R3F 3D（演出ディレクター・ロボット・地図・エフェクト）
tools/simulations   バランス・負荷テスト / tools/blender  Blender生成・GLB検査
docs/               設計・運用ドキュメント
```

## ドキュメント

- ゲーム仕様 [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) / アート [docs/ART_BIBLE.md](docs/ART_BIBLE.md)
- 設計 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) / API [docs/API_EVENTS.md](docs/API_EVENTS.md) / DB [docs/DATABASE.md](docs/DATABASE.md)
- 決済 [docs/PAYMENT_FLOW.md](docs/PAYMENT_FLOW.md) / セキュリティ [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md)
- 運営ランブック [docs/EVENT_OPERATIONS.md](docs/EVENT_OPERATIONS.md) / デプロイ [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- テスト [docs/TEST_PLAN.md](docs/TEST_PLAN.md) / バランス [docs/BALANCE_REPORT.md](docs/BALANCE_REPORT.md)
- 進捗 [docs/ROADMAP.md](docs/ROADMAP.md) / 判断記録 [docs/DECISION_LOG.md](docs/DECISION_LOG.md)

## 安全上の注意

- 既定は `PAYMENT_MODE=mock`。実決済は `PAYMENT_MODE=lnbits` と `ALLOW_REAL_PAYMENTS=true` の両方が必要で、オーナー承認が前提。
- LNbits は Invoice/read key のみ使用（アプリは送金しない）。キーはサーバーの環境変数のみ。
- 賞金・換金・払い戻し・賭け・抽選型景品はありません。1発の値段は全員同じ。観戦と応援は無料・ウォレット不要。
- 地図は独自の簡略作図（実際の行政境界ではありません）。素材台帳：[assets/LICENSES.md](assets/LICENSES.md)。
