# tools/blender — RAIJIN / FUJIN を Blender で生成する

ロボット2体を **Blender Python API（bpy）だけで** 生成し、`.blend` 保存・GLB 書き出し・プレビュー描画・検証まで
コマンドラインで行う。GUI もローカルの Blender も不要（クラウドコンテナでヘッドレス実行できる）。

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
| `apps/web/public/assets/robots/<robot>.glb` | ゲーム用アセット（glTF 2.0, +Y up, +Z 前, WebP テクスチャ） |
| `assets/models/<robot>/previews/<robot>_{front,side,back,45}.png` | EEVEE プレビュー |
| `assets/models/<robot>/<robot>_stats.json` / `_validation.json` | 三角形数・マテリアル・テクスチャ・検証結果 |

## 構成

```
build_robot.py        エントリ：シーン初期化 → リグ → パーツ → (detail) UV アトラス＋ベイク → GLB → プレビュー → .blend
validate_robot.py     保存済み .blend / .glb を開き直して検証
robots/raijin.py      雷神のデザイン（寸法・マテリアル・パーツ）
robots/fujin.py       風神のデザイン
robotkit/geo.py       bmesh 用プリミティブ（テーパー箱・旋盤・トーラス・押し出し・ロフト）
robotkit/parts.py     パーツ＝1オブジェクト＝1ボーン（頂点グループ＋Armature）。Mirror / Bevel モディファイア
robotkit/rig.py       共通スケルトン（three.js のジョイント名・手続き型リグと同じ関節位置）
robotkit/surface.py   ソースマテリアルの手続きディテール（パネルライン、青海波、回路網、面取り法線）
robotkit/texture.py   UV アトラス、Cycles ベイク（BaseColor / ORM / Normal / Emission）、ゲーム用1マテリアル
robotkit/preview.py   正面・側面・背面・45° の描画
robotkit/export.py    .blend 保存、GLB 書き出し、統計
inspect_glb.mjs       依存なしの GLB チェッカー（Node）
```

## リギング・アニメーション向けの構造

- ボーン名は three.js 側のジョイント名と同一（`Root, Hips, Spine, Chest, Neck, Head, UpperArm_L/R, Forearm_L/R,
  Hand_L/R, Thigh_L/R, Shin_L/R, Foot_L/R, BackUnit`）。`_L/_R` は Blender の左右反転ポーズに対応。
- ボーンは手足に沿って向き（腕・脚は下向き、足はつま先向き、BackUnit は後ろ向き）、ロールは全ボーンで
  ローカル X ＝ ワールド +X（肘・膝は X 軸回りに曲がる）。IK を追加しやすい。ボーンコレクション：Body / Arm.L/R / Leg.L/R / BackUnit。
- 各パーツは独立オブジェクトで、ボーン名の頂点グループに 100% ウェイト＋Armature モディファイア（剛体スキン）。
  ウェイトを塗り直す・パーツを結合する・変形するパーツを足す、のいずれもスケルトンを変えずにできる。
- GLB にはアニメーションクリップを入れていない。ゲームは `packages/three-game` の手続き型クリップで動かす
  （ボーンのレスト向きの違いは `robots/glbRig.ts` が吸収）。アーティストが同名クリップ（Idle, Intro, …）を
  ベイクして書き出せば、そのクリップが優先される。

## ゲーム向け最適化

- 三角形：RAIJIN / FUJIN とも 30k 前後（予算 ≤ 100k、目標 30–60k）。面取りは箱型パーツの硬いエッジだけに
  ウェイトで限定し、丸物・リベット・発光帯には掛けない。
- テクスチャ：全パーツを1枚の UV アトラスにまとめ、BaseColor / ORM（R=AO, G=粗さ, B=金属）/ Normal / Emission を
  2048² にベイク。GLB では WebP 圧縮。1マテリアル（FUJIN は半透明の風袋のみ別マテリアル）→ パーツ数分の描画コール。
- 鏡像パーツの UV は重ねて解像度を節約（Mirror モディファイアの UV をそのまま利用）。

## 注意

- 生成物は会場投入可能なたたき台。最終的な造形・アニメーションの判断は人間のアーティストが行うこと（ART_BIBLE）。
- ソースマテリアル（`RJ_Armor` など）は `.blend` にフェイクユーザー付きで残してある。形状を変えたら
  `build_robot.py` を再実行するとアトラスが作り直される。
