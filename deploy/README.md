# VPS 1台で公開する（Caddy + systemd）

画面（Next.js）とゲームサーバー（Fastify + Socket.IO + SQLite）を **1台の VPS・1つのドメイン** で動かす手順。
Caddy が https（Let's Encrypt）を自動で取り、`/api` `/socket.io` をゲームサーバーへ、それ以外を画面へ振り分ける。
同じドメインなのでログインの Cookie・WebSocket・CSP の設定がいちばん単純になる（D-068）。

> **公開・実決済はオーナーの判断で行う。** このキットは準備で、作業者（Claude）は VPS に触れていない。
> 実決済（LNbits）は承認されるまで使わない：本番サーバーは `PAYMENT_MODE=mock` のあいだ**無料イベント**しか開けない
> （`PASS_MODE=PAID` は起動時と管理画面で拒否される）。

```
スマホ・会場PC ──https──▶ Caddy (:443) ──┬─ /api, /socket.io, /healthz … ─▶ ゲームサーバー 127.0.0.1:4000
                                          └─ それ以外（ページ・3Dモデル）  ─▶ Next.js       127.0.0.1:3000
                                                                    SQLite・バックアップ：/var/lib/sats-wars
```

## 用意するもの

| もの       | 目安                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| VPS        | Ubuntu 24.04（または Debian 12）、**2 vCPU / 2GB** 推奨（1GB でも動くがビルドにスワップを使うので遅い）、ディスク 20GB |
| ドメイン   | 例 `game.example.com`。DNS の A（と AAAA）レコードを VPS の IP に向けておく                                            |
| メール     | Let's Encrypt の連絡先（証明書の期限切れ通知など）                                                                     |
| リポジトリ | 公開リポジトリなら HTTPS の URL。非公開なら読み取り専用の Deploy key（GitHub → Settings → Deploy keys）と SSH の URL   |

負荷の目安は `docs/LOAD_TEST_REPORT.md`（50人＋観客100接続で CPU 約4%、メモリ約135MB。localhost での測定）。

## 1. 初回セットアップ（約10分）

```bash
ssh root@<VPSのIP>
curl -fsSLO https://raw.githubusercontent.com/<owner>/robotbattle/main/deploy/setup-vps.sh   # 非公開なら scp で送る
bash setup-vps.sh --domain game.example.com --email you@example.com \
  --repo https://github.com/<owner>/robotbattle.git --event-id my-event-2026
```

やること：Node.js 22・pnpm・Caddy の導入、`satswars` ユーザーとディレクトリ、メモリが少なければスワップ2GB、
ファイアウォール（22/80/443 のみ）、設定ファイル（管理パスワードを自動生成）、systemd と Caddy の設定、最初のリリースのビルドと起動。
最後に表示される **管理パスワードを控える**（`/etc/sats-wars/server.env` にもある）。

確認：`https://game.example.com/arena`（会場画面）、`/play`（スマホ）、`/admin`（運営）。

## 2. 更新（新しいコミットを出す）

```bash
sudo bash /opt/sats-wars/repo/deploy/deploy.sh            # GitHub の main の最新
sudo bash /opt/sats-wars/repo/deploy/deploy.sh v1.2.0     # タグやコミットも指定できる
```

- 新しいリリースは今のサイトを動かしたまま `/opt/sats-wars/releases/<日時>-<コミット>` にビルドする。
- 切り替える前に DB をバックアップ → `current` を差し替え → 再起動 → ヘルスチェックとスモークテスト。
  **新しい版が正常に起動しなければ自動で前の版に戻す。**
- **作戦（レイド）中は止まる**（作戦の合間に実行する）。どうしても今なら `FORCE=1`（作戦は一時停止→自動再開）。
- 直近3つのリリースを残す。

## 3. 戻す

```bash
sudo bash /opt/sats-wars/repo/deploy/rollback.sh                       # 1つ前の版へ
sudo bash /opt/sats-wars/repo/deploy/rollback.sh 20261029T040000Z-abc1234
```

コードだけが戻り、データ（パイロット・記録）はそのまま。DB の変更は列やテーブルの追加だけなので、古い版でも動く。
データごと戻すときは `rollback.sh` の先頭のコメントにある手順で、`deploy.sh` が取ったバックアップを復元する。

## 4. すぐ効く調整

| 変えたいもの                                             | 方法                                                                                                                           | 反映                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 難度（EASY/NORMAL/HARD）・定員・会場名・画面の言語       | `/admin` →「次のレイド」                                                                                                       | 次のレイドから             |
| 受付停止・名前表示・アナウンス・緊急停止・会場画面の表示 | `/admin` のスイッチ                                                                                                            | すぐ                       |
| 敵の数値などの細かい設定                                 | API `PUT /api/admin/next-config`（owner のトークン。`docs/API.md`）                                                            | 次のレイドから             |
| サーバーの設定（`/etc/sats-wars/server.env`）            | 編集して `sudo systemctl restart sats-wars-server`                                                                             | 再起動後（作戦は自動再開） |
| `NEXT_PUBLIC_*`（`/etc/sats-wars/web.env`）              | 編集して `deploy.sh` をもう一度（ビルドに埋め込まれるため）                                                                    | 次のデプロイ               |
| スタッフの個別アカウント                                 | `node /opt/sats-wars/current/tools/admin-user.mjs <名前> <viewer\|operator\|owner>` → 出た行を `ADMIN_USERS=` に追記して再起動 | 再起動後                   |

## 5. 見る・調べる

```bash
systemctl status sats-wars-server sats-wars-web caddy
journalctl -u sats-wars-server -f            # ゲームサーバーのログ（JSON）
journalctl -u sats-wars-web -f
sudo tail -f /var/log/caddy/sats-wars-access.log   # アクセスログ（IP を含むので1週間で消える）
ls /var/lib/sats-wars/backups                # DB バックアップ（レイド終了ごと・30分ごと・デプロイ前）
```

`/admin` の「監視」でソケット数・遅延・メモリ・会場画面の FPS も見られる。

## ファイル

| ファイル                                                           | 置き場所（VPS）                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `Caddyfile.template`                                               | `/etc/caddy/Caddyfile`（ドメインとメールを埋める）                    |
| `systemd/sats-wars-server.service` `systemd/sats-wars-web.service` | `/etc/systemd/system/`                                                |
| `env/server.env.template`                                          | `/etc/sats-wars/server.env`（秘密情報はここだけ、root:satswars 0640） |
| `env/web.env.template`                                             | `/etc/sats-wars/web.env`（秘密情報なし）                              |
| `setup-vps.sh` `deploy.sh` `rollback.sh`                           | `/opt/sats-wars/repo/deploy/` から実行                                |

## この環境で確かめたこと・確かめていないこと

確かめた（開発コンテナ）：本物の `deploy.sh` と `rollback.sh` を、https のプロキシ（Caddyfile と同じ振り分け）と
`satswars` ユーザーで動く2つのサービスに対して実行（初回デプロイ、更新、手動ロールバック、壊れた版の自動切り戻し）。
同じドメイン越しにゲスト搭乗・ミッション・WebSocket・CSP・スモークテストを Playwright で確認。systemd の設定は `systemd-analyze verify` で検査。

確かめていない：本物の Caddy（このコンテナでは外部バイナリを実行できなかった。VPS では `setup-vps.sh` が
`caddy validate` してから読み込む）、本物の systemd での起動とサンドボックス設定、Let's Encrypt の証明書取得、実際の VPS とネットワーク。
