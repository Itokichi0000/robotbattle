# DATABASE

実装：`apps/server/src/db/database.ts`（マイグレーション、追記のみ）、`repo.ts`（全SQL）。開発・現行運用は SQLite（`node:sqlite`, WAL）。

単位：金額は sats の整数。`*_at` は UTC epoch ms。`t` / `*_game_ms` はゲーム時計（ms、pause補正済み）。

ZAP BATTLE（D-023）でスキーマを作り直した。既定のDBファイル名も `./data/sats-wars-v2.db` に変えたため旧DBとは衝突しない。
旧スキーマ（`participants` テーブルあり）のファイルを指定すると起動時に明示的なエラーで止まる（黙って混在させない）。

| テーブル | 主な列 | 備考 |
|---|---|---|
| `matches` | id, config_version, config_json(凍結), seed, status, phase, clock_ms, started_at, ended_at, winner_team_id, result_json, final_snapshot_json, revision, created_at | 1行＝1シーズン |
| `match_commands` | (match_id, idx), t, command_json | **正のデータ**。リプレイで状態を再構築（START/TICK/ZAP/PAUSE/RESUME/CANCEL） |
| `game_events` | (match_id, seq), t, game_ms, type, payload_json, state_revision | GameEvent（再生可能な履歴） |
| `rounds` | (match_id, round_index), region_id, hp_max, winner_team_id, end_reason, duration_ms, zaps_raijin, zaps_fujin, finisher_player_id | ラウンド結果の射影 |
| `players` | id, session_id_hash(UNIQUE), device_hash, nickname, nickname_hidden, team_id, **credit_sats(CHECK ≥ 0)**, zaps_total, kos, created_at, last_seen_at | シーズンをまたいで存続 |
| `credit_ledger` | id, player_id, delta_sats, balance_after, reason(TOPUP/PASS/ZAP/ADJUST), ref_id, created_at | 追記専用の残高台帳 |
| `invoices` | id, player_id, provider, lnbits_checking_id, payment_hash(UNIQUE), amount_sats, bolt11(保存期限あり), memo, expires_at, status, created_at, verified_at, credited_at, last_checked_at, check_failures | チャージ請求書 |
| `zaps` | id, player_id, match_id, client_action_id, round_index, team_id, code, damage, special, pinch, cost_sats, at_game_ms, created_at, **UNIQUE(player_id, client_action_id)** | 着弾したパンチのみ。再送の冪等性 |
| `sponsored_passes` | id_hash(SHA-256), label, amount_sats, issued_by, issued_at, expires_at, redeemed_at, redeemed_by_player_id, status | 配布コード。平文は保存しない |
| `admin_audit_log` | id, actor, action, target_id, before_after_json, timestamp | 秘密情報を含めない |
| `settings` | key, value_json | paymentsEnabled, autoLoop, nextConfig |

## 原子性

パンチは同期処理の1トランザクション：残高確認 → エンジン `reduce(ZAP)` → コマンド・イベント永続化 →
（着弾したときだけ）`credit_sats -= 21` と `credit_ledger`・`zaps` 挿入。途中で例外が出ればすべてロールバックされ、
エンジン状態も元に戻る（`MatchRuntime.dispatch` の persistExtra）。

チャージの加算は `UPDATE invoices SET status='PAID' … WHERE status='PENDING'` が1行更新できたときだけ行う。

## スナップショットと再構築

`MatchRuntime.recover`：`createMatchState(config, seed)` → `match_commands` を順に `reduce` → `matches.clock_ms` まで進める → 走行中なら PAUSE(SERVER_RESTART)。
自動ループONなら10秒後に自動で再開（`RESTART_AUTO_RESUME_MS`）。イベントは同じ seq で再生成され、`INSERT OR IGNORE` で欠損分のみ補完される。
残高はDBの `players.credit_sats` が正（エンジンは残高を持たない）。

## データ保持

- BOLT11 文字列：決済確定/失効から24時間で NULL 化（`purgeBolt11`、ポーリング毎に実行）。
- IPアドレス：DBに保存しない（ログイン監査は末尾をマスク）。
- シーズン・イベント・台帳は監査のため保持。削除方針はイベント後に運営が決定（SECURITY_AND_PRIVACY.md）。

## PostgreSQL への移行

`Repo` のメソッド単位で非同期版を実装し、`MatchRuntime.dispatch` の永続化をトランザクション内で await する形に変更する。
その際「残高確認→適用→課金→永続化」の原子性は、シーズンごとの単一ライター（プロセス内キュー）＋ DB トランザクションで維持する。
