# ARCHITECTURE — SATS WARS: EARTH DEFENSE

## 全体像

```
 スマホ /play (Next.js, 2D)          会場PC /arena (Next.js + R3F 3D)        運営 /admin
   │ HTTP (Cookie sw_session)          │ Socket.IO (arena)                    │ HTTP (Bearer) + Socket.IO
   │ Socket.IO (pilot)                 │                                      │
   ▼                                   ▼                                      ▼
 ┌───────────────────────────── apps/server (Fastify 5 + Socket.IO 4, :4000) ─────────────────────────────┐
 │ routes/public  routes/auth  routes/admin   realtime/socket                                            │
 │ raid/manager (ScaledClock, ロビー/自動開始/結果/次レイド, 運営スイッチ)                                   │
 │   └ raid/runtime (1レイド: reduce → コマンド+イベントを同期トランザクションで永続化 → 配信)                │
 │ raid/pilotActions (搭乗・席変更・ミッション要求/提出(冪等)・応援)   demo/bots (BOT, solveTask)            │
 │ auth/sessions (HttpOnly Cookie)  auth/lnurl (LUD-04)  auth/admin   pilots/service (経歴・称号・パスポート)  │
 │ payments/passes (出撃パス・スポンサーパス・遅延入金) → adapter: mock | lnbits (invoice/read key のみ)     │
 │ db/repo (node:sqlite 同期, WAL)                                                                         │
 └──────────────────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                                │ 純粋関数
                              packages/game-engine (reduce, tasks, rules, snapshotCore)
                              packages/shared (型・Zod・GameConfig・都市/地図・i18n・RaidStore)
```

- **サーバー権威**：ゲームの状態・乱数・ミニゲームのパラメータ・採点・勝敗はすべてサーバー（エンジン）。クライアントは入力と表示だけ。
- **1プロセス・単一の権威レイド**：会場1か所・最大100パイロット想定。水平分割は将来（D-036）。
- 3D（`packages/three-game`）は `ArenaDirector` がサーバー確定イベントを演出キューに変換して再生するだけ。WebGL不可・コンテキスト喪失時は2D表示に切替。

## パッケージ（仕様書 F2 との対応：D-033）

| 仕様書              | このリポジトリ         | 内容                                                                    |
| ------------------- | ---------------------- | ----------------------------------------------------------------------- |
| packages/game-core  | `packages/game-engine` | 状態機械、敵AI、ミニゲーム生成/採点/ソルバ、SYNC、必殺、補佐AI、結果    |
| packages/protocol   | `packages/shared`      | 型、Zodスキーマ（HTTP/Socket）、GameConfig、都市・地図、i18n、RaidStore |
| packages/ui         | `packages/ui`          | 操縦席・ミニゲーム・HUD・結果カード（web と solo で共用、素のCSS）      |
| packages/three-game | `packages/three-game`  | 3Dシーン、演出ディレクター、手続き生成ロボ/ボス、効果音                 |
| apps/game-server    | `apps/server`          | HTTP/Socket、永続化、認証、決済、管理                                   |
| apps/web            | `apps/web`             | 全画面（/play /arena /admin …）                                         |
| —                   | `apps/solo`            | オフライン体験版（LocalRaid がブラウザ内でエンジンとBOTを実行）         |
| tools/blender       | `tools/blender`        | bpy 生成スクリプト                                                      |
| tools/simulations   | `tools/simulations`    | バランスシミュレーター・負荷試験                                        |

## エンジン（`packages/game-engine`）

- `reduce(state, command) → { state, events, outcome }`。コマンド：`OPEN_LOBBY, START, TICK, BOARD, CHANGE_ROLE, REQUEST_TASK, SUBMIT_TASK, PAUSE, RESUME, END, CANCEL`。
- 時刻 `t` は pause 補正済みの単調時計（ms）。`gameMs` は START からの経過（一時停止中は進まない）。
- `advanceTo(t)` がタイマーを**ゲーム時刻順**に処理：フェーズ切替、敵出現、敵AI（待機→予告→攻撃→回復）、必殺窓の開閉、SYNC減衰、補佐AI、時間切れ。
  コマンドは同時刻のタイマー処理の後に適用。TICK は状態が変わったときだけイベントを出す。
- 乱数は state 内の mulberry32。コマンドログ（tickを除く）から `replay()` で同一状態を再現（テストで保証）。
- 全イベントに事後の公開盤面 `BoardPatch`（都市・ロボ・敵・予告・SYNC・必殺・統計・結果、搭乗変化時は crew）を添付。
  ミッションのパラメータ（`Pilot.task`）は公開盤面に含めない（本人にだけ返す）。

## レイドの状態遷移

```
CREATED ─OPEN_LOBBY→ LOBBY_OPEN ─START(自動/運営)→ LIVE ⇄ PAUSED
                                                   │
                         ボス撃破 / 都市<4 / 8分 / END → ENDED ─(結果30秒)→ 次の CREATED→LOBBY_OPEN（自動ループ）
                         CANCEL（どこからでも） → CANCELLED
phase: LOBBY → INTRO_TRAINING → WAVE_1 → WAVE_2 → WAVE_3 → FINAL_WAVE → SUCCEEDED | FAILED
```

- サーバー再起動時：未終了レイドをコマンドログからリプレイし、LIVE なら `PAUSED (SERVER_RESTART)` で復元。運営が RESUME。
- 自動ループ・搭乗停止・名前非表示・決済停止・決済連携停止・パスモード（FREE/PAID）は `settings` テーブルに保存（再起動後も保持）。

## 同期（Socket.IO）

- 全クライアントが `public` ルーム。`raid:event`（seq連番＋patch）、`raid:snapshot`（全量）、`raid:clock`（2秒ごとの時刻アンカー）、
  `raid:cheer`、`raid:presence`、`server:notice`。パイロットは `p:<pilotId>` ルームで `pilot:entitlement` を受ける。
- クライアントは `RaidStore`：重複は無視、欠番・別レイドは `raid:request-snapshot` で全量再取得。15秒ごとにも念のため再同期。
- 時刻：`time:sync` で NTP 風にオフセット推定し、`estimateClock` でゲーム時刻を補間（カウントダウン・ミニゲーム）。
- ミニゲームの時刻は「タスクを受け取ってからの経過ms」をクライアントが送り、サーバーは自分の経過時間＋2.5秒の猶予を上限に採点。

## 永続化（SQLite / `node:sqlite`）

| テーブル                                              | 内容                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| raids                                                 | レイド（設定JSON・configHash・seed・状態・結果・最終スナップショット）  |
| raid_commands / raid_events                           | コマンドログ（リプレイ用）とイベントログ（seq）                         |
| pilots / sessions / pilot_auth_keys / auth_challenges | パイロット、セッション（SHA-256）、LNURL鍵（linking key）、k1チャレンジ |
| entitlements                                          | (raid, pilot) 一意の出撃パス（FREE/SPONSORED/LIGHTNING/DEMO/CREDIT）    |
| pilot_raids / passport_history                        | 搭乗記録、パスポート（作戦ごとのスタンプ）                              |
| submissions                                           | (pilot, clientSubmissionId) の提出結果（冪等）                          |
| invoices / sponsored_passes                           | 請求書（遅延時の扱い）、スポンサーパス（コードはハッシュのみ保存）      |
| admin_audit_log / settings / schema_migrations        | 監査ログ、運営スイッチ、マイグレーション                                |

- 「検証 → reduce → コマンドとイベントの保存」を同期APIの1トランザクションで行う（await を挟まない）。
- 仕様書推奨の PostgreSQL ではなく SQLite を採用（D-037）。`db/repo.ts` が唯一の差し替え点。

## 認証・セッション

- ゲスト：`POST /api/auth/guest`（コールサイン任意、端末IDのハッシュで同じゲストを返す）。
- Lightning：LNURL-auth（LUD-04）。k1（32B）を発行 → bech32 LNURL を QR/ディープリンク → ウォレットが `callback?k1&sig&key` →
  DER署名を圧縮公開鍵で検証 → このブラウザ（`sw_lnurl_bind` Cookie）だけがセッションを受け取る。k1 は1回限り・120秒・試行5回。
  開発用モックウォレットは同じコールバック検証を通る。ゲストの記録は本人の確認後に統合（1回限りのトークン）。
- セッション：HttpOnly・SameSite=Lax Cookie（本番は Secure）。DBには SHA-256 のみ。全端末ログアウトあり。
- 管理者：`ADMIN_PASSWORD` → Bearer トークン（sessionStorage）。全操作を監査ログへ。

## 出撃パス・決済

`payments/passes.ts`。詳細は `docs/API.md` と `docs/SECURITY.md`。

- `ensureEntitled`：既存パス → FREE/DEMO モード → パス残高（CREDIT）→ なければ 402 PASS_REQUIRED。搭乗締切（240秒）後は 409。
- 請求書：1パイロット1レイドにつき有効な1件（再要求は同じ請求書）。締切まで45秒を切ったら発行しない。請求書の期限は締切の15秒前まで。Webhook／ポーリング／状態照会のたびに LNbits へ再照会し、
  PAID を確認したら冪等にパス付与（締切後なら次のレイドのパス残高）。決済ボタンや Webhook 本文だけでは何も付与しない。

## Web（`apps/web`）

- Next.js 16 App Router。全ページがクライアントコンポーネントで、`lib/connection.ts`（RaidConnection＋RaidStore）と
  `lib/api.ts`（`credentials: 'include'`）でサーバーと通信。サーバーURLは既定で「同じホスト:4000」（会場LAN向け）。
- `/play` は `@sats-wars/ui` の `Cockpit` に `httpRaidClient` を渡す。`apps/solo` は同じ `Cockpit` に `LocalRaid` を渡す。

## 性能の考え方

- サーバーtick 100ms。イベントは小さい盤面全体を毎回送る（8都市・2機・数体の敵）。会場の大画面1〜数台＋スマホ100台を想定。
- 3Dは低/中/高の品質プロファイル、シャドウ・DPR・星の数を切替。演出は群衆の連打で飽和しないよう間引き（2Hz以下）。
- 実測値は `docs/PROGRESS.md`（負荷試験）と `docs/OPEN_ISSUES.md`（会場GPU未計測）。
