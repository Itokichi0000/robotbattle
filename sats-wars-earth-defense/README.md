# SATS WARS: EARTH DEFENSE

**ONE MECH. EIGHT PILOTS. DEFEND JAPAN.** — 8人の力で、日本を守れ。

ビットコイン関連カンファレンス向けの参加型3Dブラウザゲーム。会場の大画面に巨大メカ **RAIJIN-01（雷神）** と侵略体
**NULL SWARM / NULL CORE** の戦闘がリアルタイム3Dで映り、来場者はスマホで機体の一部（8席・4役割）に搭乗して協力し、
日本の都市を守ります。仕様の正本は [`CLAUDE.md`](CLAUDE.md)（オーナー提供 BUILD DIRECTIVE v1.0）。

> 現在の到達点：**Phase 0〜4 と Phase 6 の自動 QA**。8席すべての操作・RAIJIN OVERDRIVE・LNURL-auth 認証・共有エネルギーパルス
> （sandbox の VIRTUAL 決済と、承認後にだけ有効にできる LNbits 実決済アダプター）まで動きます。**3D の本番アート（Phase 5）は未着手**で、
> 画面に「仮モデル」と明示しています。実ウォレット・実決済・会場 GPU での試験は未実施（公開ドメインとオーナー承認が必要）。
> 進捗と次の作業は [`docs/00_execution_plan.md`](docs/00_execution_plan.md) と [`NEXT_ACTIONS.md`](NEXT_ACTIONS.md)。

## すぐに動かす（鍵・外部サービス不要の sandbox）

**コマンドは1つだけ**（Mac / Linux。リポジトリ直下でも、このフォルダでも同じ）：

```bash
./start.sh
```

これで次をすべて自動で行い、大画面と運営画面をブラウザで開きます。止めるときはそのターミナルで Ctrl+C。

1. Node.js 22.13 以上を確認（なければ Mac は Homebrew で入れるか聞きます）
2. pnpm がなくても Node 付属の corepack で動かす（グローバルに何も入れない）
3. 依存パッケージを導入（初回だけ。ロックファイルが変わったときも）
4. 運営パスワードを作って `.env` に保存（初回だけ。以後は同じパスワード）
5. ビルド（コードが変わったときだけ。変わっていなければ数秒で起動）
6. サーバーを起動して、URL と運営パスワードを表示

最初にリポジトリを取ってくるところから：

```bash
git clone https://github.com/Itokichi0000/robotbattle.git
```

```bash
cd robotbattle && git checkout claude/new-session-ik9unw && ./start.sh
```

すぐ遊ぶには：運営画面にログイン → 「DEMO BOTS」をオン → 「出撃する」（運営画面の一番上に、今押すべきボタンが1つ出ます）。スマホは PC と同じ Wi-Fi で大画面の QR を読み取ります。
ポートを変えるときは `PORT=4500 ./start.sh`、ブラウザを開かないときは `./start.sh --no-open`。
常に sandbox（VIRTUAL パルスのみ・お金は動かない）で起動します。

### 手動で起動する場合（開発用）

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

### 遊び方（3幕・ゲージ1本、D-032）

試合は **3幕**。大画面の左上に「今の幕の目的」と「今やること」が常に出ます。数字は上部の4つだけ
（残り時間・守った都市・機体・**雷神ゲージ**）。

| 幕    | 名前           | 目的                                                                   |
| ----- | -------------- | ---------------------------------------------------------------------- |
| 第1幕 | ドローン迎撃   | 敵ドローンを撃ち落とす。違う役割の成功をつなぐと雷神ゲージがたまる     |
| 第2幕 | 都市を守れ     | 予告された都市への攻撃を盾で防ぐ。3都市を失うと負け                    |
| 第3幕 | NULL CORE 撃破 | 雷神ゲージ満タンで必殺技（4役割が SYNC NOW）。時間内にボスを倒せば勝利 |

1. 大画面の QR → スマホで「Lightningウォレットで認証」（LNURL-auth・無料・支払いなし）。sandbox では「ウォレットなしで DEMO GUEST」も可。
   コールサインは任意で、「大画面に表示する」を選んだときだけ表示。
2. 8席から1つ選んで `READY`。空席は AUTO SUPPORT（人より弱い）、展示時は運営の DEMO BOTS（交代可）。運営画面の「出撃する」で開始。
3. **砲撃 左/右**：ドラッグで照準 → チャージ満タンの瞬間に発射（PERFECT SHOT）。予告中の敵を先に倒すとその攻撃は消える。
4. **防衛 左/右**：予告された方向へスワイプして盾を展開（左＝前方/左、右＝右/後方）。
5. **電力 A**：炉心出力 100% を武器/防衛/機動/修理に配分。**電力 B**：過負荷で切れた回路のタイルを回してつなぎ直す。
6. **整備 A/B**：担当部位を選び、ボルトを指でぐるっと回して締める。
7. **雷神ゲージ**（チームで1本）：命中・防御・**連携**（違う役割の成功を10秒以内につなぐ）でたまる。ボス戦で満タンになると必殺技
   RAIJIN OVERDRIVE（4役割が5秒以内に SYNC NOW、人のいない役割は AUTO が代理）。
8. **炉心停止（ブラックアウト）**：第2幕・第3幕の途中で起きる（運営が「炉心停止を起こす」でいつでも起こせる）。エネルギー回復が 30% に落ち、
   直し方は2つ：① 電力B が回路をつなぐ ② 誰かがスマホから **21 sats** を送る（任意）。**どちらでも即時復旧＋雷神ゲージ +20%**。
   **sats を送れるのはこのときだけ**。送ると大画面の炉心に雷が落ち、実決済なら「請求から着金まで X 秒」が出る。払わなくても勝てる。

## コマンド

```bash
pnpm dev          # 開発サーバー（server + 3アプリの Vite を同一プロセス・同一オリジンで）
pnpm test         # ユニット + Socket.IO 統合テスト（vitest）
pnpm lint         # ESLint（警告0）
pnpm typecheck    # tsc --noEmit
pnpm format:check # Prettier
pnpm build        # server を esbuild、3アプリを vite build
pnpm start        # 本番起動（apps/server/dist + apps/*/dist を配信）
pnpm e2e          # Playwright：本番ビルドで 縦切り / LNURL-auth + VIRTUAL パルス / 8席フルソーティー（先に pnpm build）
```

- 画面キャプチャ：`OPERATOR_PASSWORD=... pnpm --filter @swed/server exec tsx ../../tools/perf/capture-phase2.ts http://localhost:4400 docs/qa/phase2`
- 負荷試験：`OPERATOR_PASSWORD=... pnpm --filter @swed/server loadtest -- --url http://localhost:4400 --pilots 8 --displays 3 --seconds 90`
- テスト用 LNURL-auth ウォレット（リハーサル用。資金を持たずログイン署名だけ）：`pnpm --filter @swed/server lnurl-wallet 'LNURL1...' [合言葉]`

## 構成

```
apps/server      Fastify 5 + Socket.IO 4。権威サーバー（20Hz シミュレーション、10Hz スナップショット）、SQLite、セッション、
                 LNURL-auth（LUD-04）、共有エネルギーパルス（sandbox / LNbits）、運営、DEMO BOTS
apps/display     大画面：React + React Three Fiber。仮 RAIJIN・敵・格納庫・東京湾・日本ホログラム・VFX・カメラ・HUD（ref 05）
apps/pilot       スマホ：React。認証 → 席選択 → READY → 8席の役割コンソール（ref 06）・OVERDRIVE・パルス → デブリーフ
apps/operator    運営：React。進行・AUTO SUPPORT・DEMO BOTS・席・共有エネルギー（SETTLE / LIVE 化）・画質/音量・接続/FPS・監査ログ
packages/shared       席・役割・フェーズ・都市/日本地図・GameConfig/プリセット・状態/イベント/Socket 契約・Zod（サーバー専用）
packages/game-engine  決定的ルール（純粋関数 reduce / advanceTo）、ヒント、BOT、ヘッドレス対戦
packages/client       クライアント共通ストア（スナップショット + イベント）、React フック
packages/ui-tokens    色・フォント・アイコン（SVG）・フレーム
tests/e2e        Playwright
tools/perf       キャプチャ/スクリーンショット（負荷試験は apps/server/scripts/loadtest.ts）
tools/blender    （Phase 5）Blender パイプライン
docs/            計画・アセット台帳・プロトコル・認証決済・運用・QA・決定ログ
references/      オーナー提供の参考画像6点（ゲームには組み込まない）
```

## 安全と運営の確認事項（必読）

- **実決済は既定で無効**。sandbox（既定）では共有エネルギーパルスは VIRTUAL（お金は動かない）。LNbits の実決済アダプターは実装済みですが、
  `APP_MODE=live` には LNbits の **invoice/read key のみ**・受取先名・https の公開 URL が必須で、起動しても **LIVE OFF** から始まり、
  運営が接続確認（LNbits と公開 Webhook）を通して `LIVE` と入力しない限り請求書は作られません。**オーナーの明示承認なしに LIVE にしないこと**
  （手順は `docs/03_auth_and_payment.md`）。送金（`out:true`）・Admin key は使いません。
- **パイロット認証は無料**。LNURL-auth は署名で「鍵を持っていること」だけを確認し（本人確認ではない）、秘密鍵・シードフレーズ・本名・
  メールを一切求めません。認証と支払いは別の画面・別の色の QR です。
- 公開画面に出る名前は `PILOT-XXXX`（ランダム）か、本人が表示を選んだコールサインだけ（運営が一括で隠せる）。公開スナップショットに
  内部 ID・鍵・支払い情報は含みません（テストで検査）。誰がいくら払ったかは表示しません。
- 課金額ランキング・賞金・抽選は作りません。勝敗は役割の協力で決まり、払わなくても最後まで遊べます。
- 会場での利用規約、送金の扱い（返金可否・受取先表示）、表示名の公開範囲は**運営者が事前に確認**してください（LIVE を有効化する前の必須事項）。
  試合終了後に確認できた支払いは繰り越さず「未反映」として運営画面と監査ログに残ります。
- 本番（`NODE_ENV=production`）は `OPERATOR_PASSWORD`（12文字以上）と https の `PUBLIC_BASE_URL` がないと起動しません。厳格な CSP・HSTS・
  HttpOnly/SameSite Cookie・Origin 検査（CSRF）・レート制限を有効にします。

## ライセンスと素材

3D はすべてコードで生成したオリジナル（外部 3D 素材は未採用）、効果音は Web Audio で合成、フォント Chakra Petch は OFL-1.1。
詳細は [`docs/01_asset_register.md`](docs/01_asset_register.md)。
