# ART_PIPELINE — アート仕様と3D制作パイプライン

すべてオリジナル。既存アニメ・ゲーム・実在ロボット・商標ロゴを模倣しない。**ロボットに ₿ 記号を付けない**。
大画面の遠距離から「太く重い橙＝雷神」「細身で俊敏な青緑＝風神」「墨黒と赤い侵蝕光＝敵」が形だけで判別できること。
雷神と風神は**同じ側に並ぶ仲間**、敵（NULL CORE と Corruptor）は正面奥。

## パレット

| 用途 | 雷神 RAIJIN | 風神 FUJIN | 侵蝕体（敵） |
|---|---|---|---|
| 識別色 | 琥珀 `#F7931A` | 青緑 `#25C8D7` | 侵蝕赤 `#FF3B5C` |
| 主装甲 | 黒鉄 `#161B20` / 琥珀橙 | 青紺 `#102836` | 墨黒 `#0B0A12` |
| 副装甲 | 銅 `#8C573A`・金 `#B88738` | 銀白 `#D7E4E8`・補助青 `#3289DF` | 紫 `#B65CFF`（アクセント） |
| 発光 | `#FFB547`（機能部分のみ） | `#25C8D7` | `#FF3B5C`（弱点・予告） |
| 記号 | ⚡ 雷鼓 | 🌀 風環 | — |

UI：黒紺 `#070D1A`、オフホワイト `#EFF5FF`。

## シルエット

- **雷神**：肩幅が広い逆三角、厚い胸装甲、巨大な拳、太い足首。背面に**雷鼓型の動力炉**（金の輪＋太鼓）。Bitcoin 要素は「ブロックの積層・鎖の結合」を装甲の意匠に抽象化（PoW を機体で計算しているとは主張しない）。
- **風神**：細身・長い脚・流線型の肩と腕、背面に**分割式の風環リング**と刃状の翼、常に少し浮遊。表面に分岐・合流する**ノード回路**の発光。
- **NULL CORE**：浮遊する巨大な球核、周囲に装甲片の輪、**独立部品の弱点**（コア・腕・脚にあたる部位）。被弾で装甲片が開き内部光が見える（流血・人体表現なし）。
- **Corruptor（護衛）**：偵察機（小さな八面体）、砲撃機（大型）、妨害機（青い発光）。侵蝕赤の発光点で味方と区別。

## 共通スケルトン（Blender ボーン名 = three.js ジョイント名）

`Root, Hips, Spine, Chest, Neck, Head, UpperArm_L/R, Forearm_L/R, Hand_L/R, Thigh_L/R, Shin_L/R, Foot_L/R` ＋ `BackUnit`（Chest の子）。
- 原点：足元中央（Root）。+Y 上、**+Z 前**、1 unit = 1 m 相当。ロボットの左 = +X。
- 仕様書 D3 の `Pelvis` `Shoulder_L/R` は `Hips` と `UpperArm` の根元で兼ねている（D-038）。

## アニメーション（クリップ名は両機共通）

`Idle, Intro, AttackLight, AttackHeavy, Guard, HitReact, Special, Victory, Defeat`（実装済み・手続き生成）。
仕様書の追加クリップ（Walk, Dash, Hover, ShieldDeploy, Charge, Boarding, HitHeavy）は未作成（OPEN_ISSUES）。
存在しないクリップは `packages/three-game/src/robots/animate.ts` の手続きアニメにフォールバックする。
群衆が数秒ごとに操作するため、攻撃・被弾クリップは短く、途中で上書きされても破綻しない動きにする。

## エフェクトとカメラ（実装済み）

- 機能に紐づくエフェクト：砲撃の雷撃ビーム（雷神→敵）、風神のシールドドーム（都市）、エネルギーの流れ（中継→機体/予備電源）、
  修理の光、予告中の都市の赤い警告、攻撃の衝撃、神雷風陣（雷と風の柱→ボス）。
- カメラプリセット：intro / overview / boss / mapFocus / special / final（`packages/three-game/src/layout.ts`）。
- **光過敏配慮**：全面フラッシュなし、点滅は2Hz以下、reduced motion で揺れ・点滅を停止、画面揺れ量は設定可能。

## アリーナ

円形の舞台、中央に日本列島のホログラム（8都市ノード・HP・シールド・警告ラベル）、外周の門柱（抽象的な鳥居風の発光）、星空。
雷神は左、風神は右、NULL CORE は正面奥の上空。

## アセットの置き場所と形式

- ロボット GLB：`apps/web/public/assets/robots/<raijin|fujin>.glb` ＋ `manifest.json`（なければ `generated/` を探す。どちらもなければ手続きモデル）。
- glTF 2.0、メートル単位、+Y up、前方 +Z（Blender は書き出し時に変換）。
- 予算：各ロボ 30k〜80k tri を目安（会場GPUでFPSを測って決める）、ボーン ≤ 64、テクスチャ ≤ 2K（baseColor / ORM / normal / emissive）。
- 検査：`node tools/blender/inspect_glb.mjs <file.glb>`（ボーン名・クリップ名・tri数）。テスト：`tools/blender/test/inspect_glb.test.ts`。

## 制作パイプライン

1. **手続きモデル（現在の既定）**：`packages/three-game/src/robots/build.ts`（雷神・風神）、`Enemies.tsx`（NULL CORE・護衛）。
   GPU・外部ツールなしで動く。
2. **手続きリグの GLB 書き出し**：`pnpm --filter @sats-wars/three-game export-glb` → `apps/web/public/assets/robots/generated/`（gitignore）。
   GLB の読み込み経路の試験用。
3. **Blender（bpy）**：`tools/blender/` のスクリプトで `.blend`（編集可能な原本）と `.glb` を生成。状況は `docs/PROGRESS.md` と `docs/OPEN_ISSUES.md`。
4. **人間のアーティストによる仕上げ**：会場品質の造形・アニメーションは自動生成では足りない。上の命名と座標系を守れば差し替えられる。

有料の3D生成AIは使わない（承認後に選択可）。外部素材を入れる場合は `assets/LICENSES.md` に出所・ライセンス・来歴を記録する。
