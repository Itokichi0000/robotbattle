# SATS WARS: EARTH DEFENSE

**ONE MECH. EVERYONE PILOTS. DEFEND EARTH.** — エイリアンが地球に来る。みんなで雷神を動かして迎え撃て。

ビットコイン関連カンファレンス向けの参加型3Dブラウザゲーム。会場の大画面に巨大メカ **RAIJIN-01（雷神）** と侵略体
**NULL CORE** の戦闘がリアルタイム3Dで映り、QR を読んだ来場者全員が
3つの班（砲撃・防衛・整備）に分かれてスマホのミニゲームで雷神を動かし、地球へ向かうエイリアン母艦を迎え撃ちます。戦場は火星 → 月 → 地球と移り、各宙域の仲間の部隊を守りながら、母艦が地球に着く前に倒します（D-034, D-035）。遊ぶのは無料、**21 sats** で「雷を呼ぶ」と会場全員が雷モードになり、払った人は自分で母艦に雷を落とせます（D-035）。仕様の正本は [`CLAUDE.md`](CLAUDE.md)（オーナー提供 BUILD DIRECTIVE v1.0）。

> 現在の到達点：**群衆レイド（D-033〜035）＋ Phase 3/4 の認証・決済＋自動 QA**。班ごとのミニゲーム・みんなで発進・LNURL-auth 認証・21 sats の雷（全員の雷モード＋弱点に雷）
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

すぐ遊ぶには：運営画面にログイン → 「DEMO BOTS」をオン → 約30秒で自動出撃（待たずに始めるなら「出撃する」）。スマホは PC と同じ Wi-Fi で大画面の QR を読み取ります。
ポートを変えるときは `PORT=4500 ./start.sh`、ブラウザを開かないときは `./start.sh --no-open`。
常に sandbox（21 sats の雷は VIRTUAL のみ・お金は動かない）で起動します。

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

### 遊び方（班ごとのミニゲーム＋雷を呼ぶ、D-035）

試合は **参加受付 → 出撃（みんなで発進）→ 戦闘（2分）→ 結果**。舞台は宇宙で、エイリアン母艦が火星 → 月 → 地球へ進みます（D-034）。

1. 大画面の QR → スマホで「Lightningウォレットで認証」（LNURL-auth・無料・支払いなし）。sandbox では「ウォレットなしで DEMO GUEST」も可。
   **これで参加完了**。参加した順に **砲撃班・防衛班・整備班** のうち一番少ない班へ自動で入ります（席選びなし・人数上限なし・途中参加OK）。
2. **みんなで出動**：出撃のカウントダウン中、全員がスマホを **上にスワイプ**（ボタンでも可）。スワイプした人の割合が雷神の初期シールドになります。
3. **戦闘**：スマホは班ごとに別の画面です。1回の命中が無料の1行動（0.7秒に1回まで）。

| 班     | スマホでやること                   | 大画面の雷神                               | 足りないと                         |
| ------ | ---------------------------------- | ------------------------------------------ | ---------------------------------- |
| 砲撃班 | 飛んでくる敵機をタップで撃ち落とす | 腕からビーム、母艦の HP が減る             | 母艦が地球に到達（時間切れ）で負け |
| 防衛班 | 部隊を狙うミサイルをタップで弾く   | 肩のシールドが光る（予告された攻撃を防ぐ） | 部隊が3つやられたら負け            |
| 整備班 | 雷神の火花をタップして直す         | 修理の光、装甲が戻る                       | 装甲 0 で負け                      |

人のいない班の仕事は全員で分担（1〜2人でも遊べます）。自分の班の仕事がないときは誰でも敵機を撃てます。人数の少ない班は1回の効果が大きくなります（最大2倍）。4. **雷を呼ぶ（21 sats・任意）**：スマホの「雷を呼ぶ」→ 確認画面（金額・受取先・VIRTUAL/実決済の別）→ 請求書。着金をサーバーが確認すると、
① **会場全員が10秒間の雷モード**（全員の行動が3倍）② **払った人のスマホに母艦の弱点**が出て、タップで雷を落とせます（当たれば2倍）。
固定額・1人1試合3回・15秒に1回・1試合全体15回まで。誰が払ったかは表示しません。払わなくても勝てます。5. DEMO BOTS（6体、DEMO 表示）は自分の班の仕事をし、ときどき VIRTUAL の雷（DEMO 表示）を見せます。

## コマンド

```bash
pnpm dev          # 開発サーバー（server + 3アプリの Vite を同一プロセス・同一オリジンで）
pnpm test         # ユニット + Socket.IO 統合テスト（vitest）
pnpm lint         # ESLint（警告0）
pnpm typecheck    # tsc --noEmit
pnpm format:check # Prettier
pnpm build        # server を esbuild、3アプリを vite build
pnpm start        # 本番起動（apps/server/dist + apps/*/dist を配信）
pnpm e2e          # Playwright：本番ビルドで 班の画面 / LNURL-auth + VIRTUAL の雷と弱点への雷 / BOT と1試合通し（先に pnpm build）
```

- 画面キャプチャ：`OPERATOR_PASSWORD=... pnpm --filter @swed/server exec tsx ../../tools/perf/capture-crowd.ts http://localhost:4400 docs/qa/crowd`
- 負荷試験：`OPERATOR_PASSWORD=... pnpm --filter @swed/server loadtest -- --url http://localhost:4400 --pilots 30 --displays 3 --seconds 90`
- テスト用 LNURL-auth ウォレット（リハーサル用。資金を持たずログイン署名だけ）：`pnpm --filter @swed/server lnurl-wallet 'LNURL1...' [合言葉]`

## 構成

```
apps/server      Fastify 5 + Socket.IO 4。権威サーバー（20Hz シミュレーション、10Hz スナップショット）、SQLite、セッション、
                 LNURL-auth（LUD-04）、21 sats の雷（sandbox / LNbits）、運営、DEMO BOTS
apps/display     大画面：React + React Three Fiber。仮 RAIJIN・エイリアン母艦・格納庫・宇宙（宙域ごとに火星/月/地球）・航路ホログラム・VFX・カメラ・HUD（ref 05）
apps/pilot       スマホ：React。認証 → 班 → 発進スワイプ → 班のミニゲーム（敵機・ミサイル・火花）＋雷を呼ぶ（確認シート→弱点に雷）→ 結果
apps/operator    運営：React。進行・自動出撃・DEMO BOTS・参加人数とボタン別の回数・21 sats（SETTLE / LIVE 化）・画質/音量・接続/FPS・監査ログ
packages/shared       3行動・フェーズ・宙域と部隊（火星→月→地球）・GameConfig/プリセット・状態/イベント/Socket 契約・Zod（サーバー専用）
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

- **実決済は既定で無効**。sandbox（既定）では21 sats の雷は VIRTUAL（お金は動かない）。LNbits の実決済アダプターは実装済みですが、
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
