# tools/blender — RAIJIN / FUJIN を Blender で生成する

ロボット2体を **Blender Python API（bpy）だけで** 生成し、`.blend` 保存・GLB 書き出し・プレビュー描画・検証まで
コマンドラインで行う。GUI もローカルの Blender も不要（クラウドコンテナでヘッドレス実行できる）。

造形のマスターは **`docs/design/visual-bible-v01/`**（設定画 3 枚＋`DESIGN_RULES_FOR_BLENDER.md`）。
寸法・配色・パーツを変えるときはまずそちらを確認すること。

## 環境

| | 確認済みバージョン | 導入方法 |
|---|---|---|
| Blender（主） | **4.0.2**（`blender` CLI） | `apt-get install blender python3-numpy libegl1 libegl-mesa0 libgl1-mesa-dri` |
| Blender（互換確認） | **5.2.3 LTS**（PyPI の `bpy` モジュール） | `python3.13 -m venv v && v/bin/pip install bpy==5.2.3` |

- download.blender.org はこの環境のネットワークポリシーで遮断されているため、Ubuntu の apt 版を使用。
- apt 版は OpenImageDenoise なしでビルドされている（Cycles のデノイズは使わない設定にしてある）。
- EEVEE のヘッドレス描画には Mesa の EGL（ソフトウェア描画）が必要。

## 使い方

```bash
# 2体とも生成（.blend / .glb / プレビュー4枚 / 統計JSON）。2048px ベイク込みで1体あたり数分〜20分
blender -b --factory-startup --python-exit-code 1 -P tools/blender/build_robot.py -- --robot all

# 保存したファイルを開き直して検証（.blend の構造、GLB の再インポート）
blender -b --factory-startup -P tools/blender/validate_robot.py -- --robot all

# 速い試行：ベイクを 512px、描画なし
blender -b --factory-startup -P tools/blender/build_robot.py -- --robot fujin --atlas-size 512 --no-render

# ブロックアウトのみ（ベイク・面取りなし、フラットな PBR マテリアル）
blender -b --factory-startup -P tools/blender/build_robot.py -- --robot raijin --stage base

# bpy モジュール版（Blender 5.2）でも同じスクリプトが動く
v/bin/python tools/blender/build_robot.py --robot raijin --models-dir /tmp/out --glb-dir /tmp/out
```

`pnpm models:build` / `pnpm models:validate` も同じコマンドを呼ぶ。

## 出力

| ファイル | 内容 |
|---|---|
| `assets/models/<robot>/<robot>.blend` | 編集用ソース（パーツ別オブジェクト・リグ・モディファイアは生きたまま、テクスチャはパック済み） |
| `apps/web/public/assets/robots/<robot>.glb` | ゲーム用アセット LOD0（glTF 2.0, +Y up, +Z 前, WebP テクスチャ、≤ 50k tri） |
| `apps/web/public/assets/robots/<robot>_lod1.glb` / `_lod2.glb` | LOD1（≤ 20k tri, 1024²）/ LOD2（≤ 7k tri, 512²）、法線マップなし。`--no-lods` で省略、`--lods-only` で .blend から再書き出し |
| `assets/models/<robot>/previews/<robot>_{front,side,back,45}.png` | EEVEE プレビュー |
| `assets/models/<robot>/<robot>_stats.json` / `_validation.json` | 三角形数・マテリアル・テクスチャ・検証結果 |

## 構成

```
build_robot.py        エントリ：シーン初期化 → リグ → パーツ → (detail) UV アトラス＋ベイク → GLB → プレビュー → .blend
validate_robot.py     保存済み .blend / .glb を開き直して検証
robots/raijin.py      雷神のデザイン（寸法・マテリアル・パーツ）
robots/fujin.py       風神のデザイン
robotkit/geo.py       bmesh 用プリミティブ（テーパー箱・旋盤・トーラス・押し出し・ロフト・三つ巴）
robotkit/parts.py     パーツ＝1オブジェクト＝1ボーン（頂点グループ＋Armature）。Mirror / Bevel モディファイア
robotkit/rig.py       共通スケルトン（three.js のジョイント名・手続き型リグと同じ関節位置）
robotkit/surface.py   ソースマテリアルの手続きディテール（パネルライン、発光する継ぎ目、ノード網、面取り法線）
robotkit/texture.py   UV アトラス、Cycles ベイク（BaseColor / ORM / Normal / Emission）、ゲーム用1マテリアル
robotkit/preview.py   正面・側面・背面・45° の描画
robotkit/export.py    .blend 保存、GLB / LOD 書き出し、統計
inspect_glb.mjs       依存なしの GLB チェッカー（Node）
```

## リギング・アニメーション向けの構造

- ゲーム用の19関節（`Root, Hips, Spine, Chest, Neck, Head, UpperArm_L/R, Forearm_L/R, Hand_L/R, Thigh_L/R, Shin_L/R,
  Foot_L/R, BackUnit`）は three.js 側のジョイント名・関節位置と同一。`_L/_R` は Blender の左右反転ポーズに対応。
- 設計ルールの追加ボーン：指 `Thumb/Index/Middle/Ring/Pinky_L/R`、肩装甲 `ShoulderArmor_L/R`、
  雷神の雷鼓 `Drum_L/R`、風神の風環 `WindRing` と背面フィン `BackFin_L/R`（雷神 33 本 / 風神 34 本）。
  雷鼓と風環のボーンは回転軸方向を向いており、ボーンの Y 軸回りに回すと円盤・輪が回る（ゲームもそう動かす）。
- ボーンは手足に沿った向き、ロールは全ボーンでローカル X ＝ ワールド +X（肘・膝は X 軸回り）。IK を追加しやすい。
  ボーンコレクション：Body / Arm.L/R / Hand.L/R / Leg.L/R / BackUnit。
- 各パーツは独立オブジェクト（コレクション Head / Torso / Arms / Legs / Joints / BackUnit）。全頂点がちょうど1本の
  ボーンに 100%（剛体スキン、指は手のオブジェクト内で指ごとのボーン）＋Armature モディファイア。
  ウェイトを塗り直す・パーツを結合する・変形するパーツを足す、のいずれもスケルトンを変えずにできる。
- GLB にはアニメーションクリップを入れていない。ゲームは `packages/three-game` の手続き型クリップで動かす
  （ボーンのレスト向きの違いは `robots/glbRig.ts` が吸収）。アーティストが同名クリップをベイクして書き出せば
  そちらが優先される。設定書のクリップ名との対応：Punch・WindSlash→`AttackLight`、HeavyPunch→`AttackHeavy`、
  Hit→`HitReact`、SpecialThunder・SpecialCyclone→`Special`（Walk・Dash は現行ゲームに無い。DECISION_LOG D-030）。

## ゲーム向け最適化

- 三角形：LOD0 は RAIJIN / FUJIN とも 30k 以下（設計ルール：LOD0 ≤ 50k、LOD1 ≤ 20k、LOD2 ≤ 7k）。面取りは箱型パーツの
  硬いエッジだけにウェイトで限定し、丸物・鋲・発光帯には掛けない。LOD は面取りを外して Decimate を予算に自動で合わせる。
- テクスチャ：全パーツを1枚の UV アトラスにまとめ、BaseColor / ORM（R=AO, G=粗さ, B=金属）/ Normal / Emission を
  2048² にベイク（LOD1 は 1024²、LOD2 は 512² に縮小し法線マップは外す：遠景では効果が小さく、Decimate で生じる
  面積ゼロの UV 三角形が不正な接線を作るため）。GLB では WebP 圧縮、1マテリアル → パーツ数分の描画コール。
- 鏡像パーツの UV は重ねて解像度を節約（Mirror モディファイアの UV をそのまま利用）。

## 注意

- 生成物は会場投入可能なたたき台。最終的な造形・アニメーションの判断は人間のアーティストが行うこと（ART_BIBLE）。
- ソースマテリアル（`RJ_Armor` など）は `.blend` にフェイクユーザー付きで残してある。形状を変えたら
  `build_robot.py` を再実行するとアトラスが作り直される。
