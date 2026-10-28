# DATABASE

実装：`apps/server/src/db/database.ts`（マイグレーション、追記のみ）、`repo.ts`（全SQL）。開発・現行運用は SQLite（`node:sqlite`, WAL）。

単位：金額は sats の整数。`*_at` は UTC epoch ms。`t` / `*_game_ms` / `contested_until` 等はゲーム時計（ms）。

| テーブル | 主な列 | 備考 |
|---|---|---|
| `matches` | id, config_version, config_json(凍結), seed, status, clock_ms, lobby_opened_at, started_at, action_closed_at, ended_at, winner_team_id, result_json, final_snapshot_json, revision, created_at | Match |
| `match_commands` | (match_id, idx), t, command_json | **正のデータ**。リプレイで状態を再構築 |
| `game_events` | (match_id, seq), t, game_ms, type, payload_json, state_revision | GameEvent（再生可能な履歴） |
| `teams` | (match_id, team_id), robot_id, health, energy, participant_count, region_count, action_count | 射影 |
| `region_states` | (match_id, region_id), kind, owner_team_id, contested_by_team_id, contested_until, shield_charges, shield_expires_at, revision | 射影 |
| `clashes` | (match_id, clash_index), resolved_at_game_ms, snapshot_json, raijin_damage, fujin_damage, resulting_hp_json, special_flags_json | Clash |
| `participants` | id, match_id, team_id, nickname_sanitized, nickname_hidden, session_id_hash(UNIQUE), device_hash, source(PAID/PASS/DEMO), status, joined_at, confirmed_at, ap_total, sponsored_pass_id | AP残量はエンジン状態が正 |
| `join_reservations` | id, match_id, team_id, participant_id, expires_at, status(ACTIVE/CONFIRMED/EXPIRED/CANCELLED) | JoinReservation |
| `invoices` | id, participant_id, reservation_id, match_id, provider, lnbits_checking_id, payment_hash(UNIQUE), amount_sats, bolt11(保存期限あり), memo, expires_at, status, verified_at, fulfillment_at, last_checked_at, check_failures, late_payment_disposition, late_payment_note, carryover_pass_code | Invoice |
| `actions` | id, client_action_id, participant_id, match_id, type, target_region_id, accepted_at, at_game_ms, result, ok, state_revision, ap_before, ap_after | Action（失敗も記録） |
| `sponsored_passes` | id_hash(SHA-256), label, match_id?, issued_by, issued_at, expires_at, redeemed_at, redeemed_by_participant_id, status, kind(SPONSORED/CARRYOVER) | 平文コードは保存しない |
| `admin_audit_log` | id, actor, action, target_id, before_after_json, timestamp | 秘密情報を含めない |
| `settings` | key, value_json | paymentsEnabled, nextConfig |

## スナップショットと再構築

`MatchRuntime.recover`：`createMatchState(config, seed)` → `match_commands` を順に `reduce` → `matches.clock_ms` まで進める → 走行中なら PAUSE。
イベントは同じ seq で再生成され、`INSERT OR IGNORE` で欠損分のみ補完される。

## データ保持

- BOLT11 文字列：決済確定/失効から24時間で NULL 化（`purgeBolt11`、ポーリング毎に実行）。
- IPアドレス：DBに保存しない（ログイン監査は末尾をマスク）。
- 試合・イベントは監査のため保持。削除方針はイベント後に運営が決定（SECURITY_AND_PRIVACY.md）。

## PostgreSQL への移行

`Repo` のメソッド単位で非同期版を実装し、`MatchRuntime.dispatch` の永続化をトランザクション内で await する形に変更する。
その際「AP確認→適用→永続化」の原子性は、試合ごとの単一ライター（プロセス内キュー）＋ DB トランザクションで維持する。
