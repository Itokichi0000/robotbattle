# SATS WARS — 雷神 vs 風神

日本のビットコインカンファレンス会場向けの、完全新規リアルタイム3Dチーム対戦ゲーム。
**スマホで参加する日本列島の陣取り × 会場の大型スクリーンで激突する3Dロボットバトル × Lightning少額決済体験。**

- `/play` スマホ（2D）：参加 → 21 sats（デモではモック）またはスポンサーパス → 3AP で 攻撃/防御/充電
- `/arena` 会場PC（3D, 1920×1080）：日本列島ホログラム、雷神 vs 風神、45秒ごとの激突演出、QR
- `/admin` 運営：開始/一時停止/緊急停止/決済停止/パス発行/遅延入金対応/監査ログ
- `/` 観戦・案内、`/results/:matchId` 結果

> 現状：**デモモード（実決済なし）で1試合を完走できる MVP**。実決済（LNbits）は実装・テスト済みだが、
> 本番利用はオーナー承認後（docs/PAYMENT_FLOW.md）。3Dロボットはコード生成の仮モデル（GLB差し替え対応）。

## クイックスタート（第三者向け）

前提：Node.js **22.13 以上**、pnpm 10（`corepack enable` で可）。外部DB・Docker不要。

```bash
git clone <this repo> && cd robotbattle
pnpm install
cp .env.example .env                # 任意。ADMIN_PASSWORD を設定（未設定なら起動ログに一時パスワードを表示）
pnpm dev                            # server :4000 + web :3000
```

### デモで1試合を完走する

1. ブラウザで `http://localhost:3000/admin` → パスワードでログイン。
2. （スマホが無い場合）「デモBOT」を各チーム 4 などに設定して「適用」。
3. 「ロビー開始」→ 30秒後に自動で対戦開始（「スタート」で即開始も可）。
4. 別タブ（会場PCなら全画面 F キー）で `http://localhost:3000/arena`。中央下のボタンで音声ON。
5. スマホ（同じLAN）で QR を読む、または `http://<PCのIP>:3000/play` → 参加 → 「テスト支払いを実行（モック）」→ 地域を選んで攻撃/防御、充電。
6. 45秒ごとに激突、270秒で受付終了、300秒で結果。`/admin` →「次の試合」。

無人デモ：`DEMO_AUTOPILOT=true LOBBY_MS=15000 pnpm dev`（ロビー自動開始・BOT・自動で次試合）。

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発起動（ホットリロード） |
| `pnpm build` / `pnpm start` | 本番ビルド / 本番起動 |
| `pnpm test` | ユニット・統合テスト（vitest、約100件） |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm e2e` | Playwright E2E（サーバーを自動起動。既存の dev は停止してから） |
| `pnpm simulate` | バランスシミュレーション → `docs/BALANCE_REPORT.md` |
| `pnpm --filter @sats-wars/three-game export-glb` | 仮ロボットをGLB書き出し（GLB読込経路の確認用） |

`/arena` のURLオプション：`?mode=2d`（2D表示）、`?quality=low|medium|high`、`?reduced=1`（点滅・動き抑制）、`?stats=1`（FPS）、`?models=procedural`。
キー：F フルスクリーン、S 表示設定、M ミュート。

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
- 賞金・換金・賭け・抽選型景品はありません。観戦は無料・ウォレット不要。
- 地図は独自の簡略作図（実際の行政境界ではありません）。素材台帳：[assets/LICENSES.md](assets/LICENSES.md)。
