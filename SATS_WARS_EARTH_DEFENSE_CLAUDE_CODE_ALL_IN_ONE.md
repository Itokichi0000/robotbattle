# SATS WARS: EARTH DEFENSE — Claude Code オールインワン開発マスター指示書

> **Version:** 1.0 / 2026-10-29  
> **用途:** このMarkdownファイル **1つ** を新規リポジトリに置いてClaude Codeに渡す。入力として他の設計書は不要。作業の結果としてClaude Codeが複数のソースコード、設定ファイル、3D素材、テスト、ドキュメントを生成するのは当然許可する。  
> **前提:** 完全新規開発。元のSatsMapはコードを再利用しない。旧「雷神 vs 風神」のチーム対戦仕様は **破棄**。本書がゲーム仕様の最新版かつ最優先の根拠。  
> **大切:** 本書は「完成を宣言するための企画書」ではなく「実装・検証を行うための要求仕様」。未実装、未検証、環境上実施不可の項目は必ず区別して報告する。

---

## CLAUDE CODEへの最初の指示（この節も含めて全部読むこと）

あなたはゲームディレクター、シニアWebゲームエンジニア、リアルタイムサーバーエンジニア、セキュリティエンジニア、Blenderテクニカルアーティスト、QA担当、カンファレンス運営UXデザイナーとして行動してください。

**SATS WARS: EARTH DEFENSE（サッツウォーズ・地球防衛作戦）を、完全新規で、実際にプレイできる製品として開発してください。** 一度企画書・雛形・画面モックを作っただけで作業を終了しないこと。環境を調べ、依存関係を導入し、動くコードを書き、テストし、失敗を修正し、継続できる状態まで進めること。

### 開発の絶対ルール

1. **最新版の仕様は本書のみ。** 以前の「雷神対風神」「オレンジ軍vsブルー軍」「都道府県の陣取り」「45秒ごとの互いのロボットの殴り合い」は全て廃止する。**雷神と風神は仲間**。人類対巨大敵の協力型PvEレイドである。
2. プレイヤーは「地球防衛軍のパイロット」。**Lightningウォレットでパイロット認証**し、雷神または風神の共同操縦に参加する。ウォレットを持たない人のゲスト参加も必要。
3. 8分間の1試合を複数人がリアルタイムにプレイし、**4種の操縦席、短いミニゲーム、敵の予兆、都市防衛、シンクロ率、合体必殺技**で勝敗が決まる。
4. 3D描画は会場の `/arena` が担当。スマホの `/play` は軽量な2DタッチUI。**サーバーがゲーム状態と結果を確定**し、映像はその結果を可視化する。
5. **デモは追加アカウント・実Bitcoin・有料3D API・GPUなしでも起動できる**こと。`DEMO_MODE=true` と開発用モック認証・モック決済・手続き生成3Dアセットを用意する。
6. LNURL-authとLNbitsの**実接続用アダプターは実装**するが、実決済の実行、支払い用本番鍵の設定、公開デプロイ、外部サービスの有料API利用、外部アカウントの新規登録は**ユーザーの明示的な承認がない限り行わない**。既定は mock。
7. 上限のない有料アクション、払った金額に比例する戦闘力、有料の個人優遇、賭けや金銭的景品を実装しない。**21 sats（仮）は1試合の出撃パス**であり、戦闘操作に再課金させない。Sponsored Pass/ゲストにも公平な参加機会を与える。
8. 参加人数・ウォレット・年齢などに関して保証できないことは保証しない。LNURL-authは鍵の所持証明であり、**現実世界の本人確認ではない**。秘密鍵・シードフレーズは求めない。
9. 重要な設計判断は `docs/DECISION_LOG.md`、進捗は `docs/PROGRESS.md`、未完了・環境制約は `docs/OPEN_ISSUES.md` に残す。`CLAUDE.md` に継続的な開発ルールを要約し、新しいClaude Codeセッションで再開可能にする。
10. 大きい仕様は段階的に実装してよいが、**本書にある全機能を製品のスコープに保持する**。任意追加ではなく実装対象としてIssue/Backlogに登録し、未完了を隠さない。環境や時間の制限で途中までしかできなかったら、動いたところ、テスト結果、残作業を正直に説明する。

### 即時実施事項

- リポジトリ・既存ファイル・実行環境を確認。空ならモノレポを構築する。
- 最初に `README.md`、`CLAUDE.md`、`docs/ARCHITECTURE.md`、`docs/GAME_RULES.md`、`docs/ROADMAP.md`、`docs/DECISION_LOG.md` を本書から生成。
- その後すぐ、**サーバーで動くレイド進行 + 4操縦席のスマホUI + 会場スクリーンの3D代替ロボット + 複数プレイヤー同期**の動く縦切りを実装。
- 単体・統合・E2Eの自動テスト、ローカル起動、複数プレイヤーのデモ、スクリーンショット、パフォーマンス確認を順番に進める。
- 各マイルストーン後に未達項目を潰してから次に進む。実機が必要な箇所は検証手順を作る。

---

# PART A — プロダクトと世界観

## A1. 一行コンセプト

> **「君も地球防衛軍のパイロットになろう。Lightningウォレットで認証し、仲間と巨大機神を操縦して地球を守れ！」**

日本のビットコインカンファレンスで、来場者が会場のQRからスマホ参加する8分間の協力型3Dロボットレイド。巨大スクリーンには雷神・風神の戦闘が映り、来場者はウォレット認証を通じてデジタルの「パイロットライセンス」を獲得。砲撃、防衛、エネルギー接続、機体整備という4種類の操縦席で連携し、街を守りながら共通のボスを倒す。前の部隊のクリアタイム、都市生存率、連携スコアと競い、次のイベントでも戦績を引き継げる。

### 体験の4本柱

1. **入隊のワクワク:** `Lightningログイン → パイロット認証完了 → ライセンス発行 → コックピット搭乗` を物語として演出する。
2. **誰でも貢献:** 1タップで始められ、10〜20秒の短い操作で成果を感じられる。子ども・初心者向けの簡易モードあり。
3. **共同操縦の手応え:** 自分の操作の数秒後に3Dロボットが反応。他の役割が揃うとさらに大きな攻撃・防御になる。
4. **継続するゲーム:** ウォレット認証のプロフィール、成績、階級、称号、スキン、イベント参加履歴が次回へ残る。

### 変えてはいけない事項

- **対立陣営はない。** 雷神と風神を敵対させない。プレイヤー間の勝敗はない。競争は「チーム全体で過去の部隊記録を更新する」および「役割別の健全な貢献評価」。
- **Bitcoinの`₿`ロゴを機体に貼らない。** Bitcoinの概念（分散ノード、経路、ブロック積層、協力、Lightning）をデザイン・ゲームシステムに抽象的に埋め込む。実際のBitcoinプロトコルを模擬していると誤認させない。
- 初期表示は日本語。英語切替可能。子どもと大人のどちらにも刺さる、過度に残虐ではないスタイリッシュな和風SF。

## A2. ゲーム名・用語

- 正式仮称：`SATS WARS: EARTH DEFENSE` / `SATS WARS 地球防衛作戦`
- スローガン：`君も、パイロットになろう。` / `JOIN THE PILOTS. SAVE THE EARTH.`
- 組織：`地球防衛軍 / Earth Defense Force`（**架空の組織**であり、実在ゲーム作品の名称・世界観・ロゴ・固有演出を模倣しない。商標・名称調査のうえ必要なら独自名に変更）
- パイロット認証：`PILOT AUTHENTICATION`
- ライセンス：`PILOT LICENSE`
- ライセンス保管庫：`SATS PASSPORT`
- 機体：`雷神 / RAIJIN`、`風神 / FUJIN`
- 合体必殺技：`神雷風陣 / SHINRAI FUJIN`（仮称、ゲーム内ローカライズ）
- 協調指標：`SYNC RATE / シンクロ率`
- 防衛区域：日本8地方と主要都市のノード（後に地球全体へ拡張可能）
- 敵勢力：`侵蝕機群 / The Corruptors`（本プロジェクト用のオリジナルデザイン）
- 最終ボス：`虚蝕巨核 / NULL CORE`（仮称。一般的なSF要素の独自造形）

## A3. 対象ユーザーと現実の会場条件

- 日本人来場者が中心。英語利用者も対応。小学生から大人までを想定。
- スマホのブラウザのみで遊ぶ。アプリインストール不要、重い3D描画不要。
- 画面比率16:9の大型モニター/プロジェクター。会場PCのみWebGLで3D描画。
- 2〜100人程度を初期の検証範囲とする。目標性能は **同時50アクティブプレイヤー / 100閲覧接続**。より大規模な接続は負荷試験結果を見て拡張する。保証値と書かない。
- ウォレット未所持、LNURL-auth非対応、カメラ読取不可、通信遅延、低性能スマホへの代替導線があること。
- 重要なパイロット操作はPC/タブレットでもキーボード・クリックで操作可能。

## A4. ロールプレイの設定

雷神・風神は1人乗りではなく、**多人数の「分散コックピット」**で操縦する巨大機神。1体に何十人ものパイロットが同時搭乗できる。プレイヤーはロボット本体の移動を直接操縦せず、「砲撃」「防衛」「電力転送」「整備」という機能席で短い指令を担当し、その結果が巨大ロボットの戦闘に反映される。機体選択は所属対立ではなくその試合での搭乗先で、出撃中も条件付きで役割を変更可能。

ゲームの導入セリフ例：
- `緊急出撃要請。地球防衛軍は新たなパイロットを募集しています。`
- `Lightningウォレットでパイロット認証を実行します。送金は不要です。`
- `認証完了。PILOT-00821、雷神の第7操縦席に接続。`
- `全パイロットに通達。東京へ敵大型ビーム接近。迎撃準備！`
- `シンクロ率100%。神雷風陣、発動！`

---

# PART B — プレイヤー導線とパイロットライセンス

## B1. 参加から帰還までのユーザーフロー

`会場QR / 招待URL → トップ → 今回の作戦紹介 → (Lightning認証 or ゲスト) → ライセンス設定 → ロビー / 搭乗機体 → 21 sats出撃パス or Sponsored/無料枠 → 配属・搭乗アニメーション → 4操縦席で共同作戦 → ボス戦 / 合体必殺技 → 作戦成功・失敗 → 個人リザルト → SATS PASSPORT保存 → 次の作戦に再出撃`

**ポイント:** 認証と支払いは別。認証だけなら無料。初回ウォレット認証なしで無料で参加できる制度も用意する。金額を払っていない人の戦闘力を下げない。

## B2. 初回ログインとアカウント

### Lightningログイン（推奨）

- 標準プロトコル **LNURL-auth (LUD-04)** を採用。WoSを想定するがWoS専用にはせず、対応ウォレットを可能な範囲でサポート。
- `/auth/lightning` でサーバーが暗号学的に安全な32バイトの使い捨てチャレンジ `k1`、有効期限、状態、リレーション済みのブラウザセッションを発行。
- LUD-04準拠のログインURLをLNURLとしてQR/アプリ起動リンクで提示。スマホ同一端末はウォレットを開くボタン、別端末はQR。アプリ起動失敗時は手動コピー可能。
- 対応ウォレットが返す `key`（ドメイン固有のlinking key）、`sig`、`k1` をサーバーでsecp256k1 ECDSA検証（実装は信頼できるライブラリ）。署名検証、チャレンジ一致、期限、一回利用、session binding、ドメイン・URLを検査する。
- 認証後にHttpOnly、Secure、SameSite適切なセッションCookieを発行。認証鍵の生値は対外公開せず、DBでは鍵識別子を適切に保護してプレイヤーに結び付ける。
- **秘密鍵、シードフレーズ、ウォレット残高へのアクセス、送金許可は要求しない。** LNURL-authが認証するのはその鍵の所持であって本人の法的実在性ではない。
- ウォレットやアプリごとに認証対応が異なる。WoSの個別バージョンの対応をコードにハードコードせず、**実機互換性検証表**を用意する。
- `k1` を再利用・別ブラウザへ流用できないこと、URLへの攻撃・スパム・CSRF・なりすまし対策をテスト。

### ゲストパイロット

- ウォレットがない人でも、ニックネームを設定し、短命のサーバー発行IDで参加可能。
- イベントが許可したSponsored Passを使えば有料パスと同じ操作・同じ勝敗への貢献を得られる。
- ゲスト戦績は一時保存し、後でLightningログインすると本人が承認したうえで統合可能。別人が勝手に引き取れないようゲストセッショントークンを確認する。
- 再訪時の復旧性はウォレット認証の方が高いことをUIで説明。ただし「必ず復旧できる」と保証しない。

### プロフィール

- `pilotId`：内部のランダム識別子（連番から個人情報を推測できないもの）。会場表示用 `callsign`（任意、最大20字、絵文字・XSS対策済み）。
- アバター：初期はプリセットのヘルメット・スーツ・バイザーを選択。機体搭乗中は低負荷の小型アバターとして表示。
- 表示許可：`showNameOnArena`、`showAvatarOnArena` を本人が選択、初期は仮名のみ、未成年・ゲストに安全な設定。
- 言語、音量、動き低減、タッチ感度、補助モードの設定を保存。
- 役割履歴、レイド貢献、称号、累計出撃、参加イベント、解放済みコスメを記録。
- ウォレット変更時は**両方の鍵でログインできる状態で新しい認証鍵をリンク**。旧ウォレット利用不可の復旧は安全な別フローとして後の課題にし、自動的に同一人物扱いしない。
- アカウントの削除、公開名非表示、セッション全解除、データエクスポートを用意する。

## B3. パイロット認証・搭乗演出

1. 待機画面に `PILOT AUTHENTICATION / パイロット認証`。
2. 認証実行中に16進数の疑似ログ、レーダー、指紋風アニメーション。**実際の生体認証や本人確認を実施していると誤認させない。**
3. 成功時は `LIGHTNING VERIFIED` または `GUEST PILOT`、ライセンスカード発行、パイロット名、階級、新規出撃回数を表示。
4. 出撃パスを獲得したら `BOARDING / 搭乗` の約2〜4秒の演出。アバターが機体内部の操縦席へ移動し、コックピットのランプが点灯。
5. 大画面へ `新しいパイロットが搭乗！` を通知（個人情報は出さない）。通知は混雑時にまとめて表示し、戦闘演出を阻害しない。
6. `SKIP` と動き低減オプション必須。認証失敗は分かりやすい日本語メッセージ、再試行・ゲスト参加へ戻れる。

## B4. パスと課金体験

- デフォルト1試合21 satsを **出撃パス** として扱う。金額は運営設定で変更可能、無料イベントモードあり。
- 決済は1試合に1回のみ。追加のsatsでダメージ・シンクロ率・操作回数を買わせない。
- 出撃パスは **参加権** を示す。ロボットの「充電演出」は象徴的であり、金額による戦力差はなし。
- 参加可能な試合時間を正確に判定し、締切を過ぎた支払いはしないよう請求書発行停止と警告を実装。
- プレイヤーごとの `FREE EVENT` / `SPONSORED PASS` / `LIGHTNING PASS` を同一の参加認可インターフェースで扱う。
- 実際のLightning送金は明示的なウォレット操作でのみ行い、自動引落・ウォレット秘密鍵取得なし。

---

# PART C — レイドと操作の完全ゲーム仕様

## C1. コアゲームループ

- **基本1試合480秒（8分）**。ロビー30〜90秒、別に結果表示30秒、すべて運営が調整可能。
- `Briefing -> Boarding -> Wave1 -> Wave2 -> Wave3 -> FinalWave -> Results`。
- ループは **「予兆を見る → 役割とターゲットを選ぶ → 10〜20秒のミニゲーム操作 → 仲間の結果と集計 → 大画面で巨大ロボットの反応を見る → 次の判断」**。
- サーバーがレイドAIの予兆・被害・ゲージ・敵のHP・任務成否を確定。アニメーションの描画速度に勝敗を依存させない。
- 3Dの激しい動作中にスマホ操作不能にしない。ただしイベント単位で入力受付の開始・終了を明示し、締切後の入力は次のイベントへ自動転用しない。
- サーバーは `seed` と `configVersion`、イベント履歴を保持し、同一条件で再生できる設計。

## C2. 操縦席4種類 — すべてミニゲームを実装する

**原則**：一人一人がコックピットを持つが、ロボットの一部を操作する。開始時に4席から選べ、変更は20秒クールダウン。実行できる任務は同時に1つ。プレイヤーの連打だけでは得点が伸びないよう成功判定・クールダウンをサーバーで管理。**席と機体の対応**：GUNNERは雷神、GUARDIANは風神。ROUTERとENGINEERは両機へ支援でき、現在の搭乗機体を選ぶかサーバーが空席側へ配属する。GUNNER⇄GUARDIANへの役割変更では機体間の転送/再搭乗を演出するが、陣営変更ではなく全員同じ部隊である。

### 1) 砲撃席 / GUNNER（雷神の主攻撃担当）

- プレイヤーに敵の3弱点（`CORE`：高リスク高リターン、`ARM`：敵攻撃の弱体化、`LEG`：移動/攻撃間隔を遅くする）を表示。
- ミニゲーム：10秒程度。移動する照準を画面タップで止め、目標リングとの重なり精度を測定。低スペック/キーボードモードでは矢印キー＋確定ボタン。光過敏に配慮し点滅は抑える。
- 難易度は `EASY / NORMAL` を用意。正確な弱点選択＋タイミングが成功。判定入力をサーバーで検証し、クライアント自己申告の高スコアを信用しない（完全なチート防止は保証しない）。
- 成功時：攻撃トークンがレイドの次の確定タイミングに加算。大画面では雷神が選択した部位へパンチ/雷撃。`ARM` 命中で次の敵砲撃-10%（数値は設定値）、`LEG`で次の敵行動の予兆時間+3秒、`CORE`は高ダメージ。
- 部位破壊はHP/閾値で段階的な視覚パーツ差し替え。生々しい表現なし。

### 2) 防衛席 / GUARDIAN（風神の都市防衛担当）

- 敵の攻撃予兆（例「東京にビーム接近まで12秒」）がサーバーから配信。
- ミニゲーム：脅威方向（上・下・左右／3方向まで）を見てシールドを選び、指定ウィンドウで長押しまたはタップ。目標都市を必ず明示。
- 成功時は都市のダメージを軽減、風神の防御スキルゲージを貯める。大画面で風神が防衛都市へ急行、風環を展開し風の障壁で攻撃を防ぐ。
- 1都市に集中すると他都市が危険。どこを守るか選択の葛藤を生む。低人数時は自動シールド補助を有効化し詰みを防ぐ。

### 3) エネルギー接続席 / ROUTER（両機への供給）

- Bitcoin Lightningの**経路接続から着想を得た**抽象化パズル。実Lightningノード・チャネル状態のシミュレーションではない。
- ミニゲーム：3〜7個のノードが表示され、開始点から雷神・風神・予備電源いずれかへルートを接続。遮断ノード、容量上限、時間制限を設ける。ドラッグ接続／タップ2回でリンク可能。
- 結果：`雷神` → 攻撃ゲージ、`風神` → 防御ゲージ、`予備電源` → 最終決戦ゲージ。接続品質が高いほどエネルギーとSYNCに加点。
- ノードの接続はアニメーションで視覚化。大画面でエネルギーの光が地図のノードを駆け抜け、雷神の雷鼓や風神の風環が点灯。
- パズル解の成立判定はサーバーがグラフに基づき検証。複雑すぎないよう初心者モードはノード3つ。

### 4) 整備席 / ENGINEER（両機・都市設備の維持）

- 雷神の装甲、雷鼓、風神の風環、都市シールド塔などが損傷した場合に修復依頼が届く。
- ミニゲーム：部品を正しいスロットにタップ/ドラッグで配置、または指示された順序の2〜4個のスイッチを操作。視力・運動機能に配慮し、ドラッグ不要の代替入力を用意。
- 成功時は機体部位/施設の耐久力回復、装備の機能制限を解消、SYNCに加点。大画面で装甲の光が復旧し整備ドローンが飛ぶ。
- 修復は上限を超えず、HP無限回復や無敵ループを禁止。

### 操縦席間のフェアネス

- 攻撃担当だけを優遇しない。各任務のスコアを `任務重要度 × 成功度 × 協調寄与 × 担当者数調整` などで標準化し、役割別MVPを設ける。
- 任務がない席には緊急支援・再配置・訓練ミニゲームを表示する。操作不能な待ち時間を極小化。
- `ASSIST MODE`ではタップ中心の簡易入力。操作難度差による一方的な評価低下を避け、ランキングの集計条件を透明化する。

## C3. 8分のレイド進行（サーバーゲーム時刻で判定）

| ゲーム時間 | フェーズ | 画面・敵の挙動 | プレイヤーがすること |
|---|---|---|---|
| 0:00–1:00 | `INTRO_TRAINING` | 東京上空に敵影。雷神・風神の出撃。安全なチュートリアル脅威 | 席選択、最初の1操作。失敗しても致命傷なし |
| 1:00–2:30 | `WAVE_1` | 小型侵蝕機が2〜3都市を攻撃、弱点が明瞭 | 攻撃、シールド、電力接続の基本を習得 |
| 2:30–4:30 | `WAVE_2` | 中型敵、都市の同時危機、機体の軽い損傷 | 防御先選択、修復と攻撃の分担 |
| 4:30–6:30 | `WAVE_3` | 最終ボス登場。弱点3部位。予備電源を確保 | 弱点選択、動きの予測、SYNC上昇 |
| 6:30–8:00 | `FINAL_WAVE` | ボスのチャージ攻撃、30秒間の合体技チャンス | 残った都市を守り、協力条件を達成して神雷風陣 |

- ゲーム時間は運営の `PAUSE` で止める。実時間ベースのUI時計だけで結果を判定しない。フェーズ・敵行動・イベント締切はサーバーの基準で決定。
- 途中でボスHPが0なら早期勝利。ただしダメージ処理の同一tick終了後に判断する。
- 8分終了でボスHPが残っていれば防衛失敗。**都市が残り3以下**になった場合も即時敗北（初期閾値、configurable）。
- 勝利条件：ボスHPを0にし、防衛都市4以上が生存。単に時間経過で成功としない。
- 敵の強さと必要協力人数をアクティブ人数に応じて調整。途中参加/切断に対して突然難度が激変しないよう、30秒ごとに平滑化された参加人数を使用。
- 参加受付はデフォルト開始4分まで。受付時に「残り時間」と21 satsパスの条件を明示。受付終了後は観戦・次回予約導線。
- デモ用に時間を10倍速/一時停止できる管理者コマンドを用意。ただし本番では無効化、ログに残す。

## C4. 防衛マップ — 日本の8地域

元の陣取り仕様を**廃止**し、日本各地に配置された防衛ノード（都市・施設）を守る形へ変更。

| 地域 | 都市ノード例 | 拠点機能（ゲーム上の抽象） |
|---|---|---|
| 北海道 | 札幌 | 監視レーダー：敵の予兆を少し早く表示 |
| 東北 | 仙台 | 修復ドック：整備成功時の回復補正 |
| 関東 | 東京 | 中央指令所：シンクロ率の維持に寄与 |
| 中部 | 名古屋 | 供給ハブ：ルートパズルのエネルギー補正 |
| 近畿 | 大阪 | 防衛中枢：防御成功時の都市被害軽減 |
| 中国 | 広島 | 妨害装置：敵の攻撃予兆を延長 |
| 四国 | 高松 | センサー網：弱点表示の補助 |
| 九州・沖縄 | 福岡 | 予備電源：最終技のチャージ補正 |

- ノードは初期耐久100、0で機能停止（壊れた都市のビジュアルは過度に惨たらしくしない）。復旧条件・上限・クールダウンを設定。
- 都市の攻撃方向、標的、残り時間が大画面とスマホで同期する。
- 重要ノードが全て失われても「自動的に詰み」にならないよう残存機能/救済ミッションがあること。ただし戦略的に不利になる。
- 8都市をクリックできる地図（日本の輪郭は権利確認済みの地理データを利用）。準備できない間は都市ノードのグラフで代替し、後に差し替える。
- 地域名・都市名は現実の地理に即したものを表示。ゲーム内の施設の位置や能力は架空の設定と明記。

## C5. 敵AIとボス

### 敵種類

1. `SCOUT / 侵蝕偵察機`：予兆8–12秒。単体都市へ小ダメージ。砲撃役の練習向け。
2. `SIEGE / 侵蝕砲撃機`：予兆12–18秒。都市を大きく攻撃。風神シールドと砲撃のどちらで対応するか選択。
3. `SABOTEUR / 侵蝕妨害機`：電力ノードのリンクを一時遮断。ROUTER / ENGINEER連携が重要。
4. `BOSS / NULL CORE`：3弱点（コア・腕・脚）と複数フェーズ、範囲攻撃、最終ビームを持つ巨大機械生命体。完全オリジナルデザイン。

### 敵AIの決定ルール

- 既定では**決定論的なステートマシン + seed付き乱数**を使う。外部のLLM APIをゲームプレイ中に呼ばない。
- `Idle → Telegraph → ActionResolve → Recovery`。ボスはHP閾値や時刻で `PhaseChange`。状態と次アクションはイベントとして記録。
- `Telegraph`では**攻撃対象・攻撃種類・残り秒数を明示**。反応不能な即死攻撃を通常ゲームに入れない。
- ターゲットは都市残HP、機能、前回標的、フェーズ、乱数seedで選ぶ。偏った無限連続標的を避けるルールを実装。
- 難度はアクティブ人数と直近の協力成功率からゆるやかに変化させる。スコア比較時は `difficultyConfigHash` を一致条件とする。
- ボスの見た目・破損部位・攻撃アニメーションはゲームイベントに従う。描画結果をゲームAIへ逆入力しない。
- 怪獣/戦闘表現は原則「機械どうしの戦闘」。流血・過激な人体破壊なし。

## C6. 初期数値（必ず設定駆動、ゲームバランスで調整）

以下は**調整可能な初期仮説**であり、実装の初期値・テスト基準。プレイテストなしに最終確定値と言わない。

```yaml
raid:
  matchSeconds: 480
  lobbySeconds: 60
  cutoffForPaidJoinAtSeconds: 240
  resultsSeconds: 30
  maxPilots: 100
  serverTickMs: 100
  resolutionStepMs: 1000
  difficultyPreset: NORMAL
  cityCount: 8
  cityMaxHp: 100
  minimumSurvivingCities: 4
  bossBaseHp: 1000
  syncInitial: 0
  syncMax: 100
  roleChangeCooldownSeconds: 20
  miniGameDurationSeconds: 12
  inputGraceSeconds: 1
  normalActionCooldownSeconds: 10
  pilotContributionWindowSeconds: 20
  actionPerPilotPerWindow: 1
  actionPowerCeilingPerPilot: 1
  special:
    availableAfterSeconds: 390
    activationWindowSeconds: 30
    requiredDistinctPilots: 3
    requiredRoles: [GUNNER, GUARDIAN, ROUTER]
    syncMinimum: 75
    energyMinimum: 80
    damage: 250
  battlePass:
    mode: mock
    sats: 21
  scoring:
    includePaymentAmount: false
    includePilotIdentity: false
```

- 人数2–3名でも必殺技に到達できる**ソロ補佐AIの役割補完**を入れる。人工的な補助の有無はリザルトに記録し、ランキングを同条件で比較。
- 人数が増えても100人の同時入力でボスが即死しないよう **役割・時間窓ごとに貢献を正規化/上限付きで集計**。例：攻撃イベントの基準ダメージを成功率の平均値とチーム連携ボーナスから計算。
- ミニゲームの成否は `0..1` の成功度、クールダウン、受理済みイベントだけを集計。APIから自称ダメージ100万などを送っても無視。
- 都市回復・機体修復・敵妨害などの値も `GameConfig` に置く。閾値はマジックナンバーとして散在させない。

## C7. 協力連鎖・シンクロ率

`SYNC RATE` は雷神と風神の連携状態を示す、0〜100の共有指標。

- 20秒間の協力ウィンドウで、異なる役割による有効アクションが成功したらSYNCが増加。
- 初期目安：2種の役割が揃うと+8、3種で追加+7、4種で追加+10。全員が同一席に集中しても最大値は伸びない。
- 時間とともに自然減少（例：非戦闘時を除き10秒ごとに-3）。連携技成功で一定量消費。連続成功時に演出ボーナス。
- 1アカウントが複数役割を短時間で渡り歩くだけで「3人協力」条件を満たせないよう、**同一ウィンドウ内でプレイヤーIDを重複カウントしない**。
- ウォレットを複数持つ人の排除はできない。認証を「一人一票」の厳密な証明に使わない。会場での不正抑止は座席・入場管理・レート制御・上限で補う。
- 大画面にはSYNCの上昇、成立した連携、貢献した操縦席のアイコンが表示される。

## C8. 協力技「神雷風陣」

### 発動条件（設定可能）

- `FINAL_WAVE` 中に協力チャンス発生。デフォルト30秒。
- レイドのSYNCが75以上、共通エネルギー80以上（0–100）、**異なる3人以上**がGUNNER、GUARDIAN、ROUTERの担当条件を達成。低人数補助AIが入った場合は記録。
- 条件成立時、サーバーが一度だけ `SpecialActivated` を確定。重複・同時押しで二重発動しない。
- 未達なら演出だけでなく、実際に次善の技を発動または防衛失敗になるなど、明確な結果分岐を設ける。最終決戦が毎回同じ映画になるのを避ける。
- バトル後に `SpecialImpactResolved`、ボスHP更新。3Dアニメーション再生が失敗しても結果は確定済み。

### 映像

1. 警報と共に `神雷風陣 起動準備`、3役割の達成ゲージが巨大スクリーンに現れる。
2. 協力したパイロットのアバター群からエネルギー線が各コックピットへ集まる。
3. 雷神の雷鼓が開き、風神の風環が回転、2体が並び立つ。
4. 雷と風が一つの大きな軌道を描き、敵のコアに命中。
5. 成功なら巨大なヒットリアクションと歓声SE、失敗なら防御/回避が起こる。**画面に誰の秘密鍵・送金情報も表示しない**。

## C9. 個人競争・レイド記録・リプレイ

- 個人は敵対しないが、**活躍の違いを見せる**：砲撃命中率、都市救助、エネルギー接続数、修復成功数、連携協力度。
- `MVP`は役割別で表彰（最優秀砲撃、守護、接続、整備、連携）。参加人数・タスク機会の偏りを補正し、金額ランキングは作らない。
- 部隊全体では「撃破時間」「都市生存率」「被害量」「SYNC平均・最大」「特殊技発動」「難度バージョン」でスコアを算出する。
- スコア算出例：`missionScore = citySurvivalPoints + normalizedSpeedPoints + coordinationPoints + bossDefeatBonus`。合計1000点に正規化し、各要素の計算式はUI・ドキュメントに表示。
- クリアできなかった場合も活動記録と役割ごとの称号が残る。勝敗だけでなく努力が報われる。
- 難度・人数補正・AI補助・ゲームバージョンが異なる試合は同じランキングに混ぜない。ランキングシーズン、イベントID、ルール版で区分。
- 試合ごとに `GameEvent` ログを残し、主要シーン（ボスHP急減、都市緊急防衛、合体技など）の**10〜20秒のハイライト再生**に必要なキーフレーム/イベントマーカーを生成。
- ハイライト動画の自動録画は可能ならブラウザの映像・MediaRecorder/サーバーキャプチャで実装。クラウド録画基盤が無い場合も、**決定論的イベントリプレイ+ブラウザ録画導線**を完備し、完成扱いの条件を区別する。

## C10. パイロット育成・SATS PASSPORT

- 初期階級：`新兵 → 防衛隊員 → 精鋭隊員 → 指揮官 → 伝説のパイロット`。昇格条件は出撃回数、異なる役割の成功、地球防衛成功、チーム連携で設定。実際の個人情報・課金総額で昇進しない。
- アバターのスキン、ヘルメット、バイザー、操縦席エフェクト、ライセンス背景、称号など**コスメのみ**解放。ゲーム中の攻撃力差は作らない。
- 持ち帰れるデジタルライセンス/パスポート画像（名前は任意・匿名可、個人戦績/称号、機体、イベント名、記念日付）を生成。Xへ直接投稿する機能は初期必須ではないが共有用画像の保存は必須。
- 過去のカンファレンスと今回の出撃履歴を一覧表示。イベント会場で限定の記念スキン/称号が解放できる機構を用意。
- ウォレット認証の変更で過去の戦績を失わないための**二重認証による連携フロー**を実装。危険な手動紐付けは管理者でも監査ログ対象。
- Nostr連携は **任意の外部ID連携アダプター** として用意。ゲーム起動や認証にNostrを必須としない。ユーザーの承認がある場合だけ公開プロフィールの表示に使用。無断Zapや投稿は行わない。

## C11. 成功条件、プレイテストで確認すべき問い

- 認証・ゲスト参加ができ、**初参加者が60秒以内に最初の有効な操作**を送れるか。
- 全席に意味があり、2人の小規模デモでもゲームが成立するか。
- 20〜50人で敵が瞬殺されず、同時操作の競合・同期破綻がないか。
- スマホの操作結果が大型スクリーンに原則数秒以内に反映されるか。
- 8分間に少なくとも3回の「全員に伝わる危機/山場」があるか。
- バトルの迫力だけでなく、**参加者の選択が結果に影響**しているか。
- 勝敗がsats送金額ではなく、協力と技術と作戦によって決まるか。
- ボス勝利の演出が長すぎず、次回試合の受付がスムーズか。

---

# PART D — アート・3D・ステージ・演出

## D1. 雷神 RAIJIN — 3D制作固定仕様

- 神話的モチーフ：雷、雷鼓、和の甲冑、鬼神の力強い輪郭。
- シルエット：肩幅広く、厚い胸装甲、巨大な拳、大きな足首、背面に**2基の雷鼓型動力炉**。遠距離でも区別可能。
- 色：黒鉄 `#161B20`、銅 `#8C573A`、金 `#B88738`、橙エネルギー `#F7931A`。金属表面はラフネスに変化をつけ、オレンジ発光は機能部分のみ。
- Bitcoin要素：装甲に**ブロックの積層・鎖状の結合**を抽象化。Proof of Workはエネルギーを生む設定上の比喩。実際のPoWの計算・採掘が機体で行われると主張しない。`₿`記号は使用しない。
- 攻撃：`Thunder Impact`（重量パンチ）、`Tenrai Cannon`（雷鼓からの集束雷撃）、合体技では中心の雷撃出力を担当。
- 破損演出：装甲を赤くするのではなく、亀裂で内部発光が見える、部品が少し開くなど機械的表現。
- 必須アニメーション：`Idle, Walk, Dash, Punch, HeavyAttack, Guard, HitLight, HitHeavy, Charge, Special, Victory, Defeat, Boarding`。

## D2. 風神 FUJIN — 3D制作固定仕様

- 神話的モチーフ：風、風袋、旋風、柔らかな流れを持つ機械構造。
- シルエット：細身・俊敏、長めの脚、肩/腕の流線型装甲、背面に**1基の大きな分割式風環リング**、空力スリット。
- 色：青紺 `#102836`、銀白 `#D7E4E8`、青緑エネルギー `#25C8D7`、補助青 `#3289DF`。
- Bitcoin要素：装甲表面に分岐/合流する**ノード接続の発光回路**、リングは経路を通るエネルギー流に反応。`₿`記号は使用しない。
- 防御：`Wind Barrier`（都市防御シールド）、`Gale Bind`（敵拘束）、雷神との合体技では風の流路を形成。
- 必須アニメーション：`Idle, Walk, Dash, Hover, Guard, ShieldDeploy, HitLight, HitHeavy, Charge, Special, Victory, Defeat, Boarding`。

## D3. 共通Blenderモデル仕様

- 完全オリジナル。既存アニメ・ゲームキャラクターや商標に酷似させない。今回の設定画は参考資料として任意で読み込めるが、**画像がない場合も本書だけで基本モデルを構築できる**こと。
- `Blender 4.x/5.x` の利用可能な安定版を検出。`bpy`のPythonスクリプトで基本モデル生成・リギング・GLB書き出しを実行。クラウドでは `blender --background --python-exit-code 1 --python scripts/blender/generate_assets.py` のような方式を使う。Blenderが未導入なら導入手順とインストールスクリプトを用意し、無理ならThree.jsの手続きモデルで代替。
- 原本 `.blend` は編集可能な状態で保存。ゲーム用 `.glb` はメッシュ、マテリアル、骨格/アニメーションを含む。元ファイルを上書きせず版管理。
- パーツ階層：`Root, Pelvis, Spine, Chest, Neck, Head, Shoulder_L/R, UpperArm_L/R, Forearm_L/R, Hand_L/R, Thigh_L/R, Shin_L/R, Foot_L/R, BackUnit`。硬質装甲は主にボーン親子付け/ウェイトを調整しゴム状変形を抑える。
- 3Dモデルはリアルワールド原点、Y-Up/glTF座標変換、スケール、左右、ルートモーションを統一し、Three.jsロードテストで検証。
- 目標目安：ロボット1体あたり **約30k〜80k三角形**、テクスチャを必要最小限、ランタイムはLODや圧縮を活用。**画質・FPS測定結果によって変更**。GPU性能によってはもっと軽いモデルが必要。
- まず低ポリゴン試作モデル2体で戦闘を完全に動かし、その後精細モデルに差替。3D生成AIの有料API利用は禁止（承認後に選択可能）。
- `.glb`のリインポートとスケルトン/アニメーションクリップの確認、プレビュー4方向（前/側/後/斜め）、動作GIF/連番PNG、モデル統計レポートを生成。
- オプションとして `assets/references/01_RAIJIN_Design_Sheet.png`、`02_FUJIN_Design_Sheet.png`、`03_ARENA_Event_Design_Sheet.png` が存在すれば参照する。**ファイルが無くても進めること**。

## D4. 機体内コックピットとパイロットアバター

- 3Dの機体内に「多数の操縦席を持つ仮想コックピット」を表現。実際に100人分の高解像度キャラをリアルタイムレンダリングする必要はなく、インスタンシング/アイコン・簡易アバターで表現。
- 砲撃・防衛・接続・整備の座席群に役割カラー/アイコンを付与。新規搭乗時に席のランプが点灯。貢献成功で個別座席に光のパルスが流れる。
- 搭乗者100人が同時出現しても、カメラ前面に名札を大量に並べない。一定時間ごとに交代表示し、重要な協力イベントでは最大5〜10人程度のコールサインを本人の表示許可に従って表示。
- Avatarは細部のあるフル3Dを初期必須とせず、2Dアイコン/軽量インスタンスで代替。達成した装飾やヘルメットが機体内アバターに反映される。
- コックピットカメラは試合中の特定イベント（搭乗、必殺技充電、結果表示）でのみ短時間使用し、主戦闘の視認性を守る。

## D5. 戦闘アリーナ / 環境アート

- 大型円形アリーナ。中心は半透明の立体日本地図/ホログラム。背景は近未来の東京を抽象化した都市シルエット＋オリジナルの和風幾何学意匠。
- 雷神と風神は同じ側に並び、巨大な敵/ボスは正面。都市防衛時には遠景に対象地域を浮かせ、ロボットが移動するカットを入れる。
- 機械生命体は墨黒・紫・赤い侵蝕光を基調に、味方2機と明確に区別。子ども向けに過度な恐怖・流血・人体表現を避ける。
- 必須アリーナ3Dアセット：地面/円形舞台、地図ノード、機体用スポーン地点、8防衛拠点、ボス本体（弱点を独立部品に）、遠景、スポットライト、警告エフェクト、シールド、雷/風の軌跡。
- 会場から離れた観客にも明瞭な「危険な都市」「残り時間」「ボスHP」「4役割の充足状況」が見える。カメラは派手だが状況認知を妨げない。

## D6. エフェクト・カメラ・音響

- 観戦用：`Intro / WideBattle / ThreatFocus / CityDefense / GunnerImpact / RouterPulse / RepairRecovery / Cockpit / SpecialCharge / SpecialHit / Victory / Defeat` のカメラシーケンス。
- エフェクトは機能に紐づく（`雷鼓点灯＝砲撃エネルギー`, `風環展開＝防御`, `ルート発光＝接続成功`, `修復ドローン＝整備`, `ノード赤色＝敵襲`）。ただ派手なだけの意味不明エフェクトにしない。
- BGM/SEは自作・明確に使用許可のある素材のみ。無断利用したアニメ音源・既存ゲーム音楽・商業音源は入れない。ダミーの自作簡易SEで機能テストを成立させる。
- 音声ON/OFF・音量・光過敏配慮（rapid strobeを避ける）・動き低減・揺れ低減・3D品質を設定可能。
- 30fps以下でも成立する簡易演出、WebGL不可時の2Dフォールバック、GPU高負荷検知時の自動品質低減を用意。

---

# PART E — UI/UX・実際の会場体験

## E1. 必須画面とルート

| パス | 想定利用者 | 必須内容 |
|---|---|---|
| `/` | 全員 | プロモーション、現レイド状態、入隊導線、ルール概要、イベント説明 |
| `/auth/lightning` | 新規/既存 | LNURL-auth QR、ウォレット起動、認証状態、失敗/ゲスト導線 |
| `/pilot/create` | 新規 | コールサイン、アバター、公開表示許可、ライセンス発行 |
| `/passport` | 認証済み | ライセンス、階級、出撃履歴、称号、設定、エクスポート/削除 |
| `/join/:raidId` | 入隊者 | 現試合、出撃パス、21 satsの明示、無料/スポンサーパス選択 |
| `/play` | 全パイロット | ミッション、4操縦席、ミニゲーム、直近の操作、役割変更 |
| `/arena` | 会場大画面 | 3Dレイド、8都市、ボスHP、残り時間、パイロット群、各役割ゲージ |
| `/results/:raidId` | 参加者/観戦 | 防衛結果、クリア時間、都市生存、MVP、共有カード |
| `/leaderboard` | 全員 | 同一難度/イベント条件で比較したレイド記録、役割別表彰 |
| `/admin` | 運営 | 次の作戦、出撃受付、緊急停止、参加人数、決済/通信、映像演出制御 |
| `/demo` | 開発・デモ | ウォレット不要で擬似プレイヤーを起動する体験モード |

## E2. `/play` 操作ルール

- 画面幅320px〜をサポートし、縦長スマホを前提に設計。大ボタン・タップ領域44px相当以上。3D描画を強制しない。
- 常時ヘッダー：`RAID TIME`、ボスHP、防衛都市数、SYNC RATE、接続状態。情報が多い場合は簡易表示へ折り畳む。
- 主表示：今の緊急ミッション（都市名、敵攻撃まで何秒、必要な役割）→ 4種類の席から選択 → ミニゲーム。
- 操作成功時：`指令が届きました`だけでなく、**「東京への被害を20防いだ」「雷神のエネルギー+8」**など計算された実結果を表示。
- 二重タップ防止、処理中表示、ネットワーク切断時のキュー再送は期限内のみ。入力締切を過ぎたら自動失敗ではなく `期限切れ` と説明。
- ミニゲームは全て **アクセシビリティ代替操作**（クリック/キーボード、ドラッグなし）を持つ。
- 残り出撃時間が少ない新規プレイヤーにも今何をすべきか1画面で分かる。テキスト/アイコン/色で表す。
- 役割変更で悪用できないよう冷却時間の残りと制約をサーバー側で管理。
- 支払い済みでも不正な連続クリックで強くならない。`taskId` と `submissionId` の重複受け付け防止。
- レイド終了後は自動でリザルトへ。途中切断した人も復帰後に結果と記録が見える。

## E3. `/arena` 3D観戦画面

**基準解像度：1920×1080 / 16:9 / 60fps目標、実環境で30fps安定の低品質設定を必須。**

- **常時:** ボスHP、残り時刻、防衛都市数、SYNC、現在のフェーズ、参加パイロット数。会場の遠くから読める字とバー。
- **通常画面:** 画面中央に雷神・風神・ボス。画面脇に日本地図と脅威ノード。コックピット群は必要に応じて小さくオーバーレイ。
- **都市危機:** 「東京にビーム接近！残り12秒」などの予兆を巨大表示。該当都市ノードに脈動（点滅激しすぎない）。必要な砲撃・防衛・接続の人数/操作達成率を示す。
- **攻撃/守護:** 入力集計後の3Dアニメーション。雷神が攻撃したターゲットが明確に分かる。風神が都市を防いだ瞬間に結果を表示。
- **SYNC上昇:** パイロット群から機体へ光が流れ、ゲージが上昇。
- **FINAL:** 3役割のゲージと残り秒数をメイン表示。神雷風陣発動後は最長8秒程度のカメラ演出、スキップ/低負荷化可能。
- **決着:** 成功・失敗を数秒で明確に表示。「生存都市数」「クリア時間」「連携成功」「貢献したパイロット」を表示。個人情報は本人許可に従う。
- **QR:** スキャン可能な参加URLを常時1か所、ボス戦で消さない。受付終了後は次の試合/観戦ページを案内。偽のURLへ飛ばさない。
- 3Dロード失敗時は **2D戦闘モード** に切替え、結果と残り時間を継続表示。
- 会場PCが接続を失った場合、最後に受信した状態を表示し `接続回復中` を表示。ブラウザの表示だけで試合を止めない。

## E4. `/admin` 会場運営

- **認証必須**、外部に公開しない。デモでも管理者ログインが必要。認証/操作ごとにサーバーで権限検査。
- 作戦作成（時間、難易度、参加費、上限、イベントID、会場名称、画面言語、デモ/本番設定）。設定のスナップショットを試合ごとに固定。
- `OPEN_LOBBY / CLOSE_LOBBY / START / PAUSE / RESUME / END / CANCEL / NEXT_RAID`。
- 敵の行動テスト用操作（DEMO限定）、必殺技演出テスト（DEMO限定）、アリーナ2D切替、品質/音量/QR表示設定。
- **キルスイッチ：** `Stop joining`, `Stop paid invoices`, `Pause game`, `Hide pilot names`, `Emergency disable payment integration` を分けて操作。
- 画面：現在の参加数、役割の偏り、稼働端末数、遅延、WebSocket状態、ボスHP、全都市HP、現在のフェーズ、未処理イベント数。
- 決済監視：発行、保留、支払済、遅延入金、スポンサーパス使用数。APIキー、シード、個人のウォレット識別鍵を表示しない。
- `SPONSORED PASS`を数量・期限・対象レイド付きで発行可能、乱用防止と監査。
- 主催者用 `Broadcast message`（固定テンプレ中心、自由文は入力サニタイズ）を会場画面・スマホへ表示。
- 障害復旧ボタンは状態を壊さない明確な処理。運営による支払い済み参加権の破棄を防ぐ。

## E5. アクセシビリティ・日本語UI

- 初期言語 `ja-JP`、`en-US` に切替。UI文言は辞書管理、JSXに散在させない。
- 子どもにも分かる用語を優先。専門用語は必要ならツールチップに説明：「Lightning＝ビットコインの少額決済技術」「認証＝ウォレットで自分の鍵を使うログイン」。
- 色だけで区別せず、形、アイコン、テキストを必ず併用。小画面でも重要な情報が読める。
- `prefers-reduced-motion`、画面揺れOFF、光過敏配慮、字幕表示、音声ミュート、効果音なしでも状況認知可能。
- 軽量2D UIは主要なモバイルブラウザ（iOS Safari/Android Chrome）で検証。インストール/ウォレット遷移後の復帰状態を保持。
- ニックネーム表示にはプロファニティ簡易フィルターと運営からの非表示。自動モデレーションには誤判定があるので運営側で調整可能。

---

# PART F — 技術アーキテクチャ

## F1. 推奨技術スタック

**単一モノレポ/TypeScript strict**。開発開始時に公式ドキュメントと互換性を調べ、安定版をロックする。特にReact/R3Fはメジャーバージョンの組合せを確認。

| 領域 | 推奨 |
|---|---|
| パッケージ管理 | `pnpm` workspace + lockfile |
| Web | `Next.js` App Router + React + TypeScript + Tailwind CSS |
| 会場3D | `three`, `@react-three/fiber`, `@react-three/drei`、GLB/glTF、必要に応じてpostprocessing |
| API/リアルタイム | Node.js + Fastify + Socket.IO（長時間稼働するゲームサーバー） |
| 共通ゲームロジック | pure TypeScript reducer/state machine、設定駆動、Zod Schema |
| DB | PostgreSQL（本番）、ローカルDocker Compose、Drizzle等のmigration可能なORM |
| 認証 | セッションCookie + LNURL-auth `k1`署名検証 + guest sessions |
| Lightning | LNbits Invoice-only API、`PaymentProvider` mock/lnbitsの差替 |
| アニメーション制作 | Blender Python API `bpy`、`.blend → .glb`。必要なら人間による造形調整 |
| テスト | Vitest、API integration、Playwright E2E、Socket.IO multi-client負荷テスト |
| ログ/監視 | 構造化ログ、ヘルスチェック、メトリクス、監査ログ、エラー画面 |
| 配置 | Next.js Webと常駐ゲームAPIを分離。DBは永続化されたサービス。単一ノードで安定させてから水平拡張 |

### 基本原則

- ゲームの真実は **唯一のサーバー状態**。UIと3Dは読み取りモデル。
- ゲームロジックはDOM/React/Threeから独立。Node.js上の単体テストができる純関数中心。
- 時間処理は `Date.now()` を乱用せず、pause補正・サーバーゲーム時刻の明確な抽象化。
- サーバーをNext.jsのサーバーレス関数で無理に常駐させない。
- 決済・認証・ゲーム状態を別モジュールに分離。ゲーム本体を動かすために実際のLightning接続を必須としない。
- 画像/3D素材が不十分でも**手続きモデル・抽象ノードで必ずゲームが動く**。未取得の有料素材を前提にしない。

## F2. モノレポの想定構造

```text
sats-wars/
├─ SATS_WARS_EARTH_DEFENSE_CLAUDE_CODE_ALL_IN_ONE.md  # 唯一の入力仕様
├─ CLAUDE.md                                 # セッション継続用・生成物
├─ README.md
├─ package.json
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
├─ .env.example
├─ docker-compose.yml
├─ apps/
│  ├─ web/                                  # Next.js /, /play, /arena, /passport, /admin
│  └─ game-server/                          # Fastify + Socket.IO + GameLoop
├─ packages/
│  ├─ game-core/                            # 決定論的ルール、敵AI、同期、得点
│  ├─ protocol/                             # REST/WebSocketの型、Zod、Error Codes
│  ├─ auth/                                 # LNURL-auth、guest、session
│  ├─ payments/                             # mock / LNbits adapters
│  ├─ ui/                                   # 共通UI部品と日本語/英語辞書
│  └─ assets/                               # GLB loader、素材manifest
├─ database/
│  ├─ schema/
│  ├─ migrations/
│  └─ seed/
├─ assets/
│  ├─ source/                               # .blend originals (必要ならGit LFS)
│  ├─ references/                           # 任意の3面図・コンセプトアート
│  ├─ models/                               # raijin.glb fujin.glb boss.glb
│  └─ audio/
├─ scripts/
│  ├─ blender/                              # bpy生成/修正/レンダリング/エクスポート
│  ├─ demo/                                 # Botパイロット、模擬シナリオ
│  └─ ops/                                  # local start, smoke tests, backups
├─ tests/
│  ├─ e2e/
│  ├─ integration/
│  ├─ performance/
│  └─ fixtures/
└─ docs/
   ├─ ARCHITECTURE.md
   ├─ GAME_RULES.md
   ├─ API.md
   ├─ SECURITY.md
   ├─ ART_PIPELINE.md
   ├─ EVENT_RUNBOOK.md
   ├─ ROADMAP.md
   ├─ DECISION_LOG.md
   ├─ PROGRESS.md
   └─ OPEN_ISSUES.md
```

## F3. サーバー状態遷移

レイド状態：

```text
CREATED → LOBBY_OPEN → BOARDING → INTRO_TRAINING → WAVE_1 → WAVE_2
                         → WAVE_3 → FINAL_WAVE → RESOLVING → SUCCEEDED/FAILED
                                                  → RESULTS → ARCHIVED
```

追加管理状態：`PAUSED`, `CANCELLED`。`PAUSED`から前状態へ再開、全てのタイマー・タスク締切をゲーム時刻基準で保持。`CANCELLED`と`ARCHIVED`は原則不可逆。イベント同一tickの処理順序は（1）期限内入力受理（2）ゲーム行動集計（3）敵攻撃判定（4）HP更新（5）最終成否判定（6）イベント発行。

- `GameConfig`は試合開始時にスナップショット化して変更不可。
- ゲームTickは100ms程度でよいが、重要なイベント解決は明示的な時間窓・一度きりの`resolutionId`で確定。
- 状態機械外の管理者操作や手動DB編集でリザルトが壊れないよう制約・監査を入れる。
- 全体停電時は最新のスナップショットから安全に復帰し、復帰不能なら`CANCELLED`として再開せず、支払済み参加者の繰越対応を運営に提示。

## F4. データベース（最低限のエンティティ）

- `Pilot(id, callsign, avatarPreset, locale, rank, createdAt, deletedAt, publicVisibilityFlags, preferences)`
- `PilotAuthKey(id, pilotId, providerType, linkingKeyFingerprint, encryptedLinkingKeyOrPublicKey, linkedAt, revokedAt)` ※ 強い公開鍵の扱いと最小化方針を検討。鍵連携は重複一意制約。
- `GuestSession(idHash, guestPilotId, expiresAt, mergedIntoPilotId, usedAt)`
- `AuthChallenge(id, k1Hash, sessionBindingHash, expiresAt, usedAt, status)`
- `Session(idHash, pilotId, issuedAt, expiresAt, revokedAt, deviceLabel?)`
- `Raid(id, eventId, seed, configVersion, configHash, difficulty, status, startedAt, endedAt, pausedMs, createdAt, winnerResult, normalizedScore)`
- `PilotRaid(raidId, pilotId, guestId?, robotAssignment, role, joinedAt, isSponsored, activeSeconds, presenceState, assistsUsed)`
- `CityState(raidId, cityId, maxHp, hp, facilityType, facilityHealth, shield, destroyedAt, revision)`
- `RobotState(raidId, robotId, health, energy, componentDamage, visualPhase, revision)`
- `EnemyState(raidId, enemyId, archetype, hp, weakPointStates, intent, phase, revision)`
- `RoleTask(taskId, raidId, role, pilotId?, startsAtGameMs, deadlineAtGameMs, seed, targetId, difficulty, status)`
- `RoleSubmission(id, taskId, pilotId, clientSubmissionId, receivedAtGameMs, actionInput, validatedScore, status)`
- `RaidEvent(raidId, seq, atGameMs, type, payload, stateRevision, createdAt)`
- `RaidSnapshot(raidId, seq, atGameMs, payload, configHash, createdAt)`
- `SyncContribution(id, raidId, role, pilotId, windowId, score, createdAt)`
- `ScoreRecord(id, raidId, pilotId, role, rawScore, normalizedScore, breakdown, configHash)`
- `Achievement(id, code, role, titleJa, titleEn, criteriaVersion)` / `PilotAchievement(pilotId, achievementId, unlockedAt, raidId?)`
- `Cosmetic(id, code, rarity, assetRef)` / `PilotCosmetic(pilotId, cosmeticId, unlockedAt, equippedAt?)`
- `PassportHistory(id, pilotId, eventId, raidId, title, score, createdAt)`
- `JoinReservation(id, raidId, pilotId, expiresAt, status)`
- `Invoice(id, reservationId, provider, checkingId, paymentHash, amountSats, status, expiresAt, verifiedAt, entitlementGrantedAt, latePaymentPolicyState)`
- `Entitlement(id, raidId, pilotId, sourceType, sourceId, grantedAt, revokedAt?)` ※ `UNIQUE(raidId,pilotId)` などで二重参加防止。
- `SponsoredPass(idHash, raidId, issuedBy, expiresAt, redeemedBy, redeemedAt, status)`
- `AdminUser(id, role, passwordHashOrExternalSubject, lastLoginAt)` / `AdminAuditLog(id, adminId, action, targetId, redactedBefore, redactedAfter, createdAt)`

**設計方針:** DB制約（ユニーク、一意インデックス、外部キー、CHECK）で二重認証/二重権限付与/同一イベント二重解決を防止。UTC保存、金額は整数sats、ゲーム時間はms整数。高頻度の位置演出などは永続化しすぎない。プライバシー対応で削除・匿名化可能なスキーマにする。

## F5. HTTP APIの要求

### Public / Player

```text
GET    /healthz
GET    /readyz
GET    /api/public/current-raid
GET    /api/raids/:id/snapshot
GET    /api/raids/:id/status
POST   /api/auth/lightning/start
GET    /api/auth/lightning/status/:challengeId
GET    /api/auth/lightning/callback                 # LUD-04仕様に準拠
POST   /api/auth/guest
POST   /api/auth/logout
GET    /api/me
PATCH  /api/me
POST   /api/me/link-wallet/start
POST   /api/me/export
DELETE /api/me
GET    /api/me/passport
GET    /api/me/achievements
POST   /api/raids/:id/join/reserve
POST   /api/raids/:id/join/invoice
GET    /api/invoices/:id/status
POST   /api/raids/:id/join/sponsored
POST   /api/raids/:id/board
POST   /api/raids/:id/change-role
GET    /api/raids/:id/tasks
POST   /api/raids/:id/tasks/:taskId/submit
GET    /api/raids/:id/results
GET    /api/leaderboard
GET    /api/passport-card
```

### Payments & Admin

```text
POST   /api/webhooks/lnbits                      # Webhookは通知扱い、実際の照会が必須
POST   /api/admin/login
POST   /api/admin/logout
GET    /api/admin/raids
POST   /api/admin/raids
POST   /api/admin/raids/:id/lobby/open
POST   /api/admin/raids/:id/start
POST   /api/admin/raids/:id/pause
POST   /api/admin/raids/:id/resume
POST   /api/admin/raids/:id/end
POST   /api/admin/raids/:id/cancel
POST   /api/admin/raids/:id/sponsored-passes
POST   /api/admin/broadcast
POST   /api/admin/emergency-stop
GET    /api/admin/metrics
GET    /api/admin/audit
```

- 上記は**ドメインAPI契約の候補**。実装時により自然なルートへ調整してよいが、全ユースケースを残し、`docs/API.md`に実際の仕様を明示する。
- すべてZodで入力検証、適切なHTTP status/error codes、レート制限、役割認可を持つ。
- 管理者APIはCSRF/Origin対策、セッション検査、監査ログを強制。**フロント側だけで権限判定しない**。
- DB更新を伴う重要なAPIは冪等キーを受け入れ、リトライしても二重処理されない。

## F6. Socket.IO リアルタイムプロトコル

クライアント → サーバー：
- `raid:subscribe` / `raid:request-snapshot` / `pilot:presence` / `pilot:select-role` / `pilot:submit-task` / `admin:command`（最後は管理者のみ）

サーバー → クライアント：
- `raid:snapshot` / `raid:event` / `raid:phase-change` / `enemy:telegraph` / `role:task-created` / `role:task-resolved` / `pilot:action-ack` / `pilot:boarding` / `city:damaged` / `city:defended` / `robot:animation-cue` / `sync:updated` / `special:activated` / `raid:result` / `server:notice`

### 共通イベントEnvelope

```typescript
type RaidEnvelope<T> = {
  raidId: string;
  seq: number;               // raid単位で単調増加
  serverTimeIso: string;
  gameTimeMs: number;
  configHash: string;
  type: string;
  payload: T;
};
```

- 初回/復帰時は `snapshot + lastSeq`、以降 `seq`付き差分。欠番を検知したらスナップショットを要求。重複受信は無視。
- クライアントの`targetHp`、`damage`、`walletPaid=true`、`score`、`roleScore`等をそのまま信用しない。サーバー計算の結果のみ送信。
- 同じレイドに対して複数のサーバーインスタンスが独立してTick処理しない。最初は1プロセス権威を実装。将来の水平拡張時のみリーダー選出/分散ロック/イベントストリームを追加。
- 再接続で同じアクションを二重適用しないよう `clientSubmissionId` + `taskId` に一意制約。
- UIはサーバー時刻との差を推定してカウントダウン。表示時刻と判定時刻のズレを許容・可視化する。

---

# PART G — LNURL-auth・Lightning決済・セキュリティ

## G1. LNURL-auth 実装詳細

### 仕様の一次資料

- LUD-04: https://github.com/lnurl/luds/blob/luds/04.md
- LUD-05: https://github.com/lnurl/luds/blob/luds/05.md
- LUD-13: https://github.com/lnurl/luds/blob/luds/13.md

**必ず実装時点の公式仕様を照合すること。** LUD-04ではサービスがランダムな32バイトの `k1` を発行し、ウォレットから返される圧縮sec p256k1公開鍵 `key` とDER形式の署名 `sig` を検証する。ウォレットの`linkingKey`は通常サービスドメインに固有で、ノード公開鍵や資金管理秘密鍵とは異なる。認証を送金と混同しない。

### 認証フロー

1. HTTPセッションを用意し、32バイトCSPRNGで `k1` を生成。チャレンジDBにはハッシュで保存、TTLを短く設定（例120秒）。`attempts`と`consumed`を管理。
2. 固定ホスト名のHTTPS callback URLを使ってLNURL-auth URLを構成。外部入力由来のcallbackURLやhostをそのまま反映しない。
3. Same-device起動ボタン、QR、LNURL値を表示。ウォレット非対応ならゲスト・再試行へ導線。
4. callback受信時、`k1`長、`key`圧縮形式/長さ、DER署名パース、secp256k1署名、チャレンジTTLと再利用有無を検証。
5. callbackを受けるHTTPリクエストとブラウザを直接同一視しない。サーバーにある challengeId + browser-bound session の状態を更新。フロントは自分のsessionで状態をポーリング/SSE受信。
6. 成功時にトランザクションでチャレンジをconsumedにし、linkingKeyに紐づくPilotをlookup/create。異なるブラウザでチャレンジを流用してもセッション奪取できないよう結び付ける。
7. セッションCookieをローテートしログイン完了。サーバーログに`k1`生値、署名、linking key全体を出さない。
8. 期限切れ、キャンセル、ウォレットアプリ未対応、QR読み込み不可、認証の途中でブラウザが離脱、同時ログインのレース条件を丁寧に処理。

### 認証セキュリティテスト

- 改変された署名、別鍵署名、不正DER、公開鍵不正長、期限切れ、callbackリプレイ、別セッションからのchallenge横取り、同時二重callback、パラメータ欠損を拒否。
- CSRF、open redirect、Hostヘッダー偽装、Origin不正、rate limit、Cookie固定化を拒否。
- 自動ウォレット起動ができない環境でQR/コピーの代替フローが機能する。
- HTTPSで動く認証コールバックをローカルでも安全に試せる開発手順を説明。ローカルでは `mock auth` が必須。
- WoSを含む対応ウォレットの個別互換性は**実機テスト結果でのみ**対応を明示。未検証のWalletに「動作確認済み」と記載しない。

## G2. Lightning決済アダプター

公式仕様（実装時点で再検証する）：
- API: https://docs.lnbits.com/api/core/payments
- 各LNbitsインスタンスのSwagger: `https://<your-lnbits-instance>/docs`

### インターフェース

```typescript
interface PaymentProvider {
  createInvoice(input: {
    amountSats: number;
    memo: string;
    expirySeconds: number;
    reservationId: string;
  }): Promise<{
    providerPaymentId: string;
    checkingId: string;
    paymentHash?: string;
    bolt11: string;
    expiresAt: string;
  }>;
  getPaymentStatus(checkingId: string): Promise<
    { status: 'PENDING' | 'PAID' | 'FAILED' | 'UNKNOWN'; amountSats?: number }
  >;
}
```

`MockPaymentProvider` と `LNbitsPaymentProvider` を両方実装。デフォルトはMock。

### LNbitsを使った本番準備

- `POST /api/v1/payments` で `out:false`、`amount`（整数sats）、`memo`、`expiry`、必要なら`webhook`を指定。
- 送金できない **Invoice key** だけを使用。Admin keyは本アプリに設定しない。ブラウザへキーを送らない。
- `checking_id` / `payment_hash` / BOLT11をDBに保存し、`GET /api/v1/payments/{checking_id}` により**サーバーから決済状態を確認**。
- Webhookは通知のきっかけであり、それ自体を支払確定とみなさない。Webhookが来ない場合は期限まで再照会。各再試行はレート制御・バックオフ。
- 受信Webhookの送信元信頼性・署名（もしプロバイダーが提供する場合）・ネットワーク安全性を検証し、最終的な支払確定はLNbits公式照会に基づく。
- `Invoice.status=PAID` と `Entitlement` 発行は**同一DBトランザクション/一意制約で冪等に一度だけ**。`paid=true` をブラウザから送る設計は禁止。
- 同じインボイスの使い回し、同じ人が複数タブで参加、期限切れ直後に入金、レイド終了後の入金、決済成功後のSocket切断、webhook重複、provider再試行を統合テスト。
- 支払済みなのに試合に参加できなかった場合のポリシー：自動的に不明瞭な没収をしない。`NEXT_RAID_CREDIT`または運営の手動対応を管理画面で明示し、監査ログと金額照合を残す。自動返金は本アプリのスコープ外、実装は承認後。
- `PAYMENT_MODE=lnbits`は**本番用設定と明示承認が揃わない限り使用不能**とする。UIにDEMO表示を明瞭に付与し、仮の送金実績を本物と誤認させない。

### 出撃の公平性

- ウォレットでのログインだけではチケットと混同しない。`authenticated` と `entitledToPlay` を別フラグ/別DB関係に分離。
- 21 satsの額は勝敗のためのリソースではない。**支払額・ウォレット残高に基づく役割補正を一切しない**。
- 1レイド1パイロット1参加権。複数ウォレットのSybilは厳密に防げない。参加枠上限、アカウント別クールダウン、同一端末の連続乱用緩和を実装し、収集する端末情報を最小限にする。
- 課金を必須にすると未成年者や初めての人が参加できない可能性があるため、Sponsored Pass/無料イベントモードを常に実装。主催者による料金設定・法務チェックが済むまで本番課金を有効化しない。

## G3. セキュリティ・プライバシーのチェックリスト

1. **認証**：LNURL-auth LUD-04準拠、チャレンジ使い捨て、secure cookies、ゲスト期限付きセッション、アカウントリンクに明示的な二重認証。
2. **決済**：APIキーはサーバーのみ、請求書専用権限、入金状態はバックエンド再照会、一意制約/冪等処理、未知の支払状態では参加権を付与しない。
3. **ゲーム操作**：クライアントは `role/taskId/input` のみ送る。ダメージ・HP・勝敗・スコア・role cooldownはサーバーで算出。task期限をサーバーで検証。
4. **悪用対策**：rate limit、BOT連打抑制、IP単位のみの過度なブロックは共有Wi-Fi利用者に不利なのでバランス調整。ソケットのroom参加権検査とメッセージスキーマ検証。
5. **データ保護**：財布残高やノード公開鍵を取得しない。生IP/ログの保持期間を必要最小限に。HTTPS/WSS、Cookie、CORS、CSRF、Content Security Policy、XSS対策。
6. **パイロット名**：文字数制限、表示先全てでエスケープ。大量の記号や絵文字でレイアウト崩れを防ぐ。公的個人情報を入力させない。
7. **未成年配慮**：年齢の断定や生体認証演出の虚偽表示を避ける。ゲスト・スポンサー参加を準備し、写真/実名/連絡先の公開を要求しない。利用規約、プライバシー案内、保護者同伴等の運営判断が必要な事項を提示。
8. **会場画面**：ニックネームやアバターの公開は本人の選択に従う。認証鍵・BOLT11・payment hash・個人IDの生値は表示しない。
9. **賞品・法令**：賭け、金銭賭博、現金価値のある景品の自動配布は初期スコープ外。イベント実施地の規約・景品・決済・未成年者対応は運営が事前に確認。
10. **失敗時**：決済プロバイダー障害では新規有料受付を停止。進行中レイドは既存パイロットとゲストで継続。管理者の緊急停止を最優先。
11. **運用**：監査ログ、シークレットスキャン、依存脆弱性チェック、DBバックアップ/復旧、ログの機密マスキング、負荷試験。
12. **コンテンツ**：既存アニメ・ゲーム等のIPや商標・BGMを模倣しない。AI生成素材も利用条件を確認し、著作権/来歴を記録。3Dモデルファイルのアップロードは運営専用・信頼できるファイルに限定。

## G4. 開発/本番環境変数（例）

```dotenv
NODE_ENV=development
APP_BASE_URL=http://localhost:3000
GAME_SERVER_URL=http://localhost:4000
DATABASE_URL=postgres://satswars:satswars@localhost:5432/satswars
SESSION_SECRET=replace-with-strong-random-secret
ADMIN_BOOTSTRAP_SECRET=replace-with-secure-random-secret
DEMO_MODE=true
AUTH_MODE=mock
PAYMENT_MODE=mock
PAYMENT_REQUIRE_EXPLICIT_ENABLE=true
LNBITS_BASE_URL=
LNBITS_INVOICE_KEY=
LNBITS_WEBHOOK_PUBLIC_URL=
EVENT_ID=local-demo
DEFAULT_LOCALE=ja-JP
RAID_SECONDS=480
TICKET_PRICE_SATS=21
PUBLIC_PARTICIPANT_URL=http://localhost:3000
```

- `.env.example` の値はダミーであり本番鍵を含めない。実 `.env` はgitignore。
- 本番実決済では `https://`、強いCookie Secret、正しい公開Webhook URL、LNbitsの本番向け設定、運営確認画面、実機試験が揃うまで起動を拒否する。
- ゲスト・無料参加を有効にしても管理者APIや支払い確定APIが無認証になるわけではない。

---

# PART H — 実装スケジュールと品質ゲート

## H1. 進め方の原則

以下の各段階は**実装順序**であって「あとでやるかもしれない任意案」ではない。Claude Codeは技術上の障害がなければ次の段階まで進める。進捗・状態を`docs/PROGRESS.md`に記録し、ユーザーが改めて毎回同じ説明をしなくても再開できるようにする。

### PHASE 0 — 新規プロジェクトの土台

- ルートのモノレポ、型、環境、Lint/Format、DBマイグレーション、構造化ログ、Docker Compose、`.env.example`、README。
- `CLAUDE.md`、ゲーム仕様、API概略、ロードマップ、決定ログを生成。
- Node/pnpm/Blenderの存在とバージョンを検査。使えない外部機能は代替を明示。
- `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` が実行できる状態。
- **受け入れ:** ローカル起動1コマンド、`/healthz`とトップ画面が表示。

### PHASE 1 — 操作できる協力型ゲームの縦切りMVP

- `/arena`：雷神・風神・ボスの3D代替モデル。2体は共闘する。8都市ノードとHPを表示。
- `/play`：GUNNER/GUARDIAN/ROUTER/ENGINEERの4席を選択できる。全席で最小の動くミニゲームを実装。
- `game-core`：レイドの状態機械、Wave1〜Final、敵予兆、サーバー権威、勝敗判定。
- 複数ブラウザ接続、Socket.IO同期、Botパイロットシミュレーター。**2〜10人の仮想プレイヤーで共闘**。
- `DEMO_MODE=true` でログイン/支払不要の安全な体験。
- **受け入れ:** 1台PCの会場画面＋2台スマホ/ブラウザで同じ試合を見て、それぞれのアクションが状態に反映され、勝利/敗北の両方を再現可能。

### PHASE 2 — ゲーム性を完成

- 8都市の固有機能、4役割のミニゲーム本番ロジック、弱点選択、敵AI/攻撃予兆、修復、ルートパズル、役割変更クールダウン。
- 20秒協力窓の集計、SYNC RATE、低人数AI補佐、人数スケーリング、神雷風陣の成功/失敗分岐。
- レイド結果、役割別MVP、難度版ごとのランキング、イベントリプレイ。
- シミュレーションを繰り返して難度調整。遊び方/ヘルプ/画面表示の日本語を磨く。
- **受け入れ:** 攻撃一辺倒の部隊よりも役割を分担した部隊が明確に有利で、全席の行動が勝敗に影響することを自動シミュレーションで確認。2/10/30/50人の人数条件で極端な即死や詰みがない。

### PHASE 3 — パイロット認証と永続進行

- LNURL-auth、QRとsame-device起動、ウォレット状態、ゲスト、プロフィール、アバター、パイロットライセンス。
- 搭乗演出、パイロット座席、操縦成功時の座席発光。Passport、階級、称号、装飾、参加履歴。
- アカウントリンク、削除、データエクスポート、セッション管理。
- Mock authでE2E、暗号署名テスト、本物のウォレット互換性試験用の実施手順を準備。
- **受け入れ:** Mock認証で新規→搭乗→出撃→保存→再ログイン→戦績復元が動く。LUD-04実装のテストベクトル合格。WoS等の実機テスト未完なら明示。

### PHASE 4 — Lightning決済とスポンサーパス

- `PaymentProvider`抽象、mockとLNbitsアダプター、請求書発行、支払待ち、サーバー支払確定、再照会/通知、障害処理、遅延入金とクレジット管理。
- 21 satsの出撃パス、Sponsored Pass、無料イベント、ゲスト公平性。
- 初期はMockで全E2Eを実行。LNbits実機はテスト環境が使用できる場合のみ（外部の実送金は承認要）。
- **受け入れ:** mock決済の重複通知、支払前の偽装、支払い確定後の切断、遅延入金、無料枠の乱用などをテスト。決済ボタンを押しただけで権限が付かない。

### PHASE 5 — Blenderによる本格3D・演出

- Blender headlessスクリプトでRAIJIN、FUJIN、NULL CORE、アリーナ、主要エフェクト/カメラを生成。ソース`.blend`とゲーム用`.glb`。
- ボーン/可動部、各機体の必須アニメーション、ダメージ段階、搭乗コックピット、アバター群。
- 3Dシーンの性能最適化、WebGL fallback、画面揺れ軽減、低品質プロファイル。
- `raijin`, `fujin`, `boss` のGLB読み込み/再生テスト。Blender実行不可の場合、生成スクリプトとプレースホルダーを実装し**3D高品質アセット未生成を未完として報告**。
- **受け入れ:** 雷神と風神が同時に敵を攻撃/防衛し、神雷風陣がイベントを受けて再生する。少なくとも1体のGLBがBlenderで生成・GLBで再読込されていることを確認。

### PHASE 6 — 大会運営・会場品質・リプレイ

- 管理者画面、緊急停止、ロビー・参加人数、課金確認、トラブル時の案内、強制終了、次の試合。監査ログ。
- イベントごとの記録ランキング、個人パスポート画像、ハイライトイベント再生。動画生成が可能なら自動動画も実装。
- WebSocket負荷試験、端末別テスト、アクセシビリティ、日本語・英語、画面サイズ検証。
- 運用ランブック（開場前チェック、回線切断、決済遅延、サーバー再起動、会期終了後バックアップ）。
- **受け入れ:** 50人模擬参加/100接続の負荷試験レポート、2Dフォールバック、管理者操作権限検査、現地設置チェックリストが揃う。数値目標を満たせなかったら測定結果を載せた改善Issueを残す。

### PHASE 7 — リリース前ハードニング（自動公開は禁止）

- 認証、決済、管理権限、Rate limit、XSS/CSRF、秘密情報、DBバックアップ、監査、障害復旧をチェック。
- 本番設定ガイドと環境差分、見積もり、スモークテスト、ロールバック手順。
- 法務・商標・著作権・未成年・決済の運営確認項目を一覧化。
- 自動で本番デプロイしない。**ユーザー承認後のみ**実決済や外部公開を実行。
- **受け入れ:** 下記のRelease Gateチェックリストを満たし、未検証の項目は未検証と表示。

## H2. 必須自動テスト

### game-core 単体テスト

- 8分の状態遷移、時間・pause補正、最終成否、都市HP境界、ボスHP境界、敵AIのseed再現。
- 同時入力の解決順序、重複action/submission、別操縦席への不正操作、role cooldown、時間外入力を拒否。
- シンクロ率、異なる3人協力、同一プレイヤー重複、補佐AI、必要人数スケーリング。
- Routerパズルの経路妥当性、Guardタイミング、Gunner命中、Engineer部品順序の正常/異常。
- 敵の行動予兆が間に合わないケースの防止、ロード待ちでゲーム時刻が進み過ぎないこと。
- 結果が送金額によって変化しないこと。支払ルートが違っても同じ戦闘権限。

### API/DB 統合テスト

- 2人同時認証、同一key二重認証、期限切れ・再利用チャレンジ、ゲスト統合、Cookie期限とログアウト。
- Invoice二重webhook、providerレスポンス改ざん、支払確認前の権限偽装、支払済みの重複参加、滞留請求書、遅延入金。
- Sponsored Pass同時使用、破損チケット、期限切れ、数量上限と監査ログ。
- DB再起動後の復元、Serverイベントseq重複・欠番の復帰、admin認可、rate limit。

### Playwright E2E

- `/`→Mockログイン→ライセンス→Mockパス→搭乗→全4操縦席→レイド結果→Passport。
- 2ブラウザで同一レイド同期、片方の切断/復帰、片方が操作してもう片方でイベント確認。
- `/arena`の3Dロード→2Dフォールバック、16:9スクショ、モバイル375×812スクショ、英語切替、動き低減。
- 管理者ログイン→開場→出撃受付→Pause→Resume→Emergency Stop→Audit。
- 通常成功ケースだけでなく、敗北・8分タイムアウト・敵の攻撃失敗分岐・特別技成功/未成功を試す。

### 負荷と堅牢性

- 2/10/30/50同時パイロット + 観客100接続のシミュレーション。ゲームTick、Server CPU/Memory、イベント伝送p95、描画FPS。
- 初期目標：リアルタイムの重要な状態変更が会場画面に **p95で3秒以内** に反映（ネットワーク環境に依存するため測定結果を開示）。
- 回線断30秒、Server再起動、DB断、LNbits断/遅延、会場PCだけの切断を想定してトラブルテスト。
- 本番リハーサルは会場PC、実Wi-Fi、代表的なiPhoneとAndroid、Lightningウォレットの実機で行う。自動テストの通過だけでは実機動作確認済みとしない。

## H3. 完了基準（Definition of Done）

- [ ] 新規リポジトリがワンコマンドで起動。再現可能な手順とlockfile。
- [ ] Lightningモック/ゲストでログインし、ライセンスを作れる。
- [ ] 雷神・風神は同じ側でボスと戦う。**対立チームUIが残っていない**。
- [ ] 4操縦席が各々異なる、操作できるミニゲームを持つ。
- [ ] 複数ブラウザで同時に操作・同期し、自分の行動が3D画面に見える。
- [ ] ボスAIの予兆、都市ダメージ、防衛、修復、ノード接続が勝敗に作用する。
- [ ] 8分レイド、複数Wave、時間切れ、早期KO、敗北条件が動作する。
- [ ] SYNC RATE、3役割協力、神雷風陣の成功/未成功分岐が動作する。
- [ ] パイロットプロフィール、階級、称号、装飾、履歴、パスポート画像が永続化される。
- [ ] LNURL-auth実装と署名検証テストがある。ウォレット実機未検証の場合は明示。
- [ ] LNbitsアダプター、請求書照会、入金の冪等な参加権付与がある。**本番入金は承認前OFF**。
- [ ] Sponsored Passと無料参加があり、戦闘力に金額差がない。
- [ ] 管理者画面、開場・PAUSE・緊急停止・監査ログが動く。
- [ ] Blender生成スクリプト、編集可能な素材、GLB読み込みテスト、失敗時代替がある。
- [ ] 3D戦闘・日本8都市・コックピットパイロット・合体技の演出がある。
- [ ] 日本語優先/英語切替、アクセシビリティ、個人表示同意、ゲスト対応がある。
- [ ] リザルト、同条件ランキング、役割別MVP、イベントリプレイ/ハイライト再生がある。
- [ ] typecheck、lint、unit、integration、E2E、負荷試験の結果が報告されている。
- [ ] README、運用手順、環境設定、QA、未完了リスト、次回再開手順が存在。

## H4. Claude Codeの各セッションの報告形式

```markdown
## 今回実装したこと
- [実際に追加/修正したファイルと機能]

## 実行した検証
- [コマンド] : PASS / FAIL / NOT RUN
- [実際のスクショ/ログ/測定値の保存先]

## デモ手順
- [起動コマンド、URL、2プレイヤーと会場画面の操作]

## 仕様未達・既知の問題
- [未実装、環境制約、手動検証待ちを明示]

## 次の実装予定
- [優先順の具体的なタスク]

## 承認が必要なこと
- [実決済/外部公開/有料APIなど、承認が必要な場合のみ]
```

- 「できます」「対応済み」と書く際は**コード、テスト、スクリーンショット、実行ログなどの証拠**を伴わせる。
- 時間制限で途中終了した場合も壊れた状態で放置せず、可能ならテストの通るコミット/ブランチへ整理し、未達を明示。
- 外部サービスのAPIキーが無ければモックで独立して進める。ユーザーに不必要な質問を繰り返さない。

---

# PART I — デモシナリオと開発者向け検証データ

## I1. 8分の見本レイド

開発用 `demo-seed: earth-defense-opening` を用意し、任意に再生可能にする。

1. **0:00:** レイド開始。Bot4人と手動プレイヤー1人が搭乗。雷神/風神が並んで登場。
2. **0:30:** 札幌で敵予兆。Guardian成功→風神がシールド。大画面で防衛成功。
3. **1:20:** 偵察機の右腕をGunnerが命中。雷神がパンチし敵攻撃弱体化。
4. **2:30:** 東京と大阪が同時危機。役割偏りで片方が被害。整備ミッションが発生。
5. **3:20:** Routerが経路接続。青緑の光が地図を流れて雷神と風神に送電。
6. **4:20:** Engineerが風神風環を修復。防御性能が復旧、SYNCが上がる。
7. **4:40:** ボス登場。コア/腕/脚の弱点が3D上に表示。
8. **6:50:** 3役割の30秒協力チャンス。異なるパイロットが協力→神雷風陣。
9. **7:30:** 成功ルートではボスHPが0、残存都市6/8、MVP発表とPassport保存。
10. **失敗ルート:** 指定ミッションを無操作にすると必要SYNC不足で合体技失敗、そのまま防衛失敗。どちらも再現可能。

## I2. デモBotとテストシミュレーター

- Botは役割分布・操作成功率を設定できる。Botの存在はスコアに記録。実ユーザーのランキングに混ぜないか、同条件の別枠で比較。
- コマンド例：`pnpm demo:seed`、`pnpm demo:raid --pilots 10 --success-rate 0.65 --seed 42`、`pnpm sim:balance --runs 1000 --pilots 2,10,30,50`。
- サーバーTick、攻撃予兆、City damage、同期、BossHP、リザルトをログに残す。
- 通常クリア率・役割分布偏り・所要時間・必要な有効アクション数を統計化。

## I3. 3D素材がなくても動く手続きモデル

- RAIJIN：黒鉄の円柱/箱装甲、肩の大きなブロック、拳、背面2基の太鼓。
- FUJIN：細身の銀青装甲、楕円脚、背面分割リングと風の帯。
- BOSS：黒紫の巨大機械体、コア・腕・脚の発光弱点。
- ARENA：円盤・日本地図ノード・遠景・カメラ・シールド/雷/風のパーティクル。
- このプレースホルダーで**全てのゲームイベント**を再生できるようにし、あとからGLBだけ差替え可能な `RobotAssetAdapter` を用意する。

---

# PART J — 将来の拡張（初期コードで拡張点を作る）

以下は追加の将来機能。現在の完成条件とは区別し、**拡張可能な設計とBacklog**のみ必須。コアの完成を妨げる場合は後回し。

- 日本8都市から47都道府県へ。地球全域の防衛ノードへ拡張。
- 国境を超えた多会場協力レイド（東京・ソウル・ニューヨーク）。時差と遅延、会場ごとの運営権限を調整。
- パイロット同士のNostr連携、Zap等のソーシャル機能（許可制、任意、デフォルトOFF）。
- 出展ブースQRを巡る会場探索クエスト、限定コスメ/称号。スポンサーによる戦闘性能優遇なし。
- ボスごとの特別な演出、機体スキン、3D観戦カメラ拡充、配信向けオーバーレイ。
- Blender/3D生成AIのクラウドパイプラインを有料GPUで強化（承認前の有料API呼び出し禁止）。

---

# PART K — 参照する一次仕様・注意事項

以下のURLは開発時に確認する。仕様の出典であり、認証・決済の最新の挙動をコードで無条件に断定するためのものではない。

- LNURL-auth LUD-04: https://github.com/lnurl/luds/blob/luds/04.md
- LNURLの各種LUD: https://github.com/lnurl/luds
- LNbits Payments API: https://docs.lnbits.com/api/core/payments
- LNbits API概要: https://docs.lnbits.com/api/
- React Three Fiber: https://r3f.docs.pmnd.rs/
- Blenderコマンドライン: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html
- Three.js GLTFLoader: https://threejs.org/docs/#examples/en/loaders/GLTFLoader

**最後の指示**：

1. 本書を読み、旧「陣営対戦」仕様が混じっていないか確認する。新規開発を始める。
2. Phase 0のセットアップからPhase 1の本当に動くマルチプレイヤーレイドを実装する。
3. Phase 1のテストが通ったら、そのまま次のフェーズに進む。**仕様書だけ作って終了しない**。
4. 各フェーズでゲームを起動し、テストし、できればスクリーンショットを残す。
5. 外部サービス設定/課金/実Lightning支払い/公開が必要なときだけ明示承認を求める。それ以外はローカルモックと手続き素材で進める。
6. この1ファイルを唯一の入力とし、すべての設計・コード・3D・資料・テスト・進捗記録をリポジトリ内に生成する。

**最初の到達点:** スマホ2台と大画面1台で、パイロットがウォレットのモック認証から搭乗し、4種類の席で操作すると雷神・風神が協力して敵に反応し、8分後に成功/失敗と記録が表示されるゲームを実際に動かすこと。
