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

### 遊び方

1. 大画面の QR → スマホで「Lightningウォレットで認証」（LNURL-auth・無料・支払いなし）。sandbox では「ウォレットなしで DEMO GUEST」も可
   （テスト用・本番認証ではないと画面に明示）。コールサインは任意で、「大画面に表示する」を選んだときだけ表示。
2. 8席から1つ選ぶ（機体図の番号＝搭乗部位）。空席は AUTO SUPPORT（人より弱い）、展示時は運営の DEMO BOTS（交代可）。
3. `READY` → 運営画面で `START` → 出撃演出（約8秒、`SKIP DEPLOY` 可）→ WAVE 1 → WAVE 2 → BOSS（NULL CORE）。
4. **砲撃 左/右**：ロック → チャージ → 発射。予告中の敵を先に倒すとその攻撃は消える。右のレールガンは弱点を露出（全砲撃 ×1.5）。
5. **防衛 左/右**：担当2方向（左＝前方/左、右＝右/後方）の予告に合わせて盾を展開。1.2秒以内で PERFECT。
6. **電力 A**：炉心出力 100% を武器/防衛/機動/修理に配分（±5 かワンタップ案）。古い版に対する送信はサーバーが拒否。
7. **電力 B**：過負荷で切れた回路の 3×3 タイルを回して左右の端子をつなぐ。切れている間はそのレーンが回復しない。
8. **整備 A/B**：担当部位（A＝脚・肩、B＝コア・両腕）をタップ → 番号順にボルトを締める → 部位の性能が戻る。
9. 異なる役割の成功が10秒以内にそろうと **TEAM SYNC** が上がる。ボス戦で SYNC≥80・CHARGE≥100 になると **RAIJIN OVERDRIVE READY** →
   4系統が5秒以内に `SYNC NOW`（人のいない系統は AUTO と明示して代理）→ 8席の光が胸に集まり、雷撃ビームがボスへ（300）。
10. ヘッダーの「+20」：任意の **共有エネルギーパルス**（固定 21 sats → CHARGE +20、1人30秒に1回・1試合3回）。sandbox では VIRTUAL
    （お金は動かず、運営が SETTLE で確定）。払わなくても最後まで遊べます。

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
