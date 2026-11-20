# ぴっ！ママとスーパーでおかいもの — 設計と取り決め

5歳の子が iPhone / iPad で、指1本だけで遊ぶ、文字のいらない Web ゲーム。
完成品は `games/261121-1/index.html` 1ファイル（`node build.cjs` で `src/` から組み立てる）。

## お話（4場面）

1. **home1 おうち・からっぽの冷蔵庫** — 台所。冷蔵庫の取っ手を横に引くと開く。中はからっぽで、たまごが1こだけ。おなかが「ぐぅ〜」。壁のエコバッグが揺れて光る → さわると おかいものへ。
2. **shelf スーパーの棚** — 冷蔵ケースに12種類。品物を指で運んで、カートの上のかごへ入れる（6こ）。取ると奥の品物が前へすべってくる。6こ入ったらカートを押してレジへ。
3. **register レジ（中心）** — かごの品物を1つずつ持って、読み取り口のガラスの上を通すと赤い光が走って「ぴっ！」。画面に品物の絵が出る。そのままエコバッグへ。全部終わるとママがカードをかざし、レシート（品物の絵がならぶ）が出てくる → 引っぱって切る → おうちへ。
4. **home2 おうち・冷蔵庫をみたす** — 冷蔵庫を開け、エコバッグから品物を出して棚へ置く。ぴっと鳴らした物がそのまま並ぶ。全部しまって扉を閉めると、レシートがマグネットで扉に貼られ、夕方のやさしい光で終わる。エコバッグにさわると、また おかいものへ（冷蔵庫の中身は残る）。

ママは体ぜんぶは出さず、**クリーム色のニットの袖の腕と手**で登場する（カートの持ち手を握る・品物を指さす・カードをかざす・レシートを貼る）。動物・おばけ・文字・数字は出さない。

## 絶対の決まり

- 文字・数字・言葉は画面に一切出さない（パッケージにも字は書かない。模様と絵だけ）。HTML の UI 重ね・矢印も禁止。
- 指1本。失敗・採点・時間制限なし。どこで離しても「やさしく元に戻る」か「吸着して成功」。当たり判定は大きく。
- 見た目は**写実・ふつうの見た目**。おもちゃ風・ローポリ・絵本風・カクカクは不可。
  - 丸い物は分割数を十分に（円周 32 以上）。箱は角を丸める（`THREE.RoundedBoxGeometry`）。
  - 素材は `MeshStandardMaterial` / `MeshPhysicalMaterial`。べた塗り1色で終わらせず、キャンバスで作った色むら・粗さの地図を使う。`MeshBasicMaterial` は光る物（画面・レーザー・光のにじみ）だけ。
  - `transmission`（屈折）は重いので使わない。透明は `transparent + opacity + depthWrite:false` と映り込みで表す。
  - 色は彩度を上げすぎない現実の色。実寸（メートル）で作る。
- 外部素材・外部読み込みなし。画像はすべてキャンバスで自作。フォント不要。
- 三角形は1場面 25万以下、描画呼び出し 250 以下を目安。形状・素材は使い回す。
- `var`/`function` 主体の素の JavaScript（ES2018 まで、モジュールなし、各ファイルは即時関数で包む）。iOS Safari 15 で動くこと。

## ファイル（読み込み順）

| ファイル | 中身 | グローバル |
|---|---|---|
| `src/vendor/three.bundle.js` | three r187 + RoomEnvironment + RoundedBoxGeometry + BufferGeometryUtils | `THREE` |
| `src/js/00-util.js` | 小道具・品物の登録簿（既にある。読んで使う） | `U`, `Items` |
| `src/js/02-audio.js` | 音（すべて Web Audio で合成） | `Sound` |
| `src/js/04-hand.js` | 手と腕 | `Hand` |
| `src/js/06-core.js` | 描画・入力・場面切り替え・手がかり・保存 | `G` |
| `src/js/08-props.js` | かご・エコバッグ | `Props` |
| `src/js/10-items-pack.js` | 品物（容器もの6種） | `Items.define` |
| `src/js/11-items-produce.js` | 品物（青果など6種） | `Items.define` |
| `src/js/20-home.js` | 場面 home1 / home2 | `G.addScene` |
| `src/js/30-shelf.js` | 場面 shelf | `G.addScene` |
| `src/js/40-register.js` | 場面 register | `G.addScene` |
| `src/js/90-main.js` | 起動・後回しのコードと裏の準備の順番 | |

three r187 の注意: `PCFSoftShadowMap` は廃止（`PCFShadowMap` を使う）。色空間は `texture.colorSpace = THREE.SRGBColorSpace`。`THREE.RoundedBoxGeometry(w,h,d,segments,radius)`、`THREE.BufferGeometryUtils.mergeGeometries([...])`。

## 座標と単位

メートル、Y が上、右手系。物の「正面」は +Z。置ける物の原点は底の中心。

## 品物（`Items`）— 00-util.js

```
Items.order = ['milk','juice','yogurt','pudding','egg','cheese','strawberry','tomato','apple','carrot','cabbage','watermelon']
Items.define(kind, {tall, sound, heavy}, build)   // build() -> THREE.Group（原点=底の中心、正面 +Z、実寸）
Items.make(kind) -> THREE.Group の複製。userData = {kind, w, h, d, r, cy}
Items.info[kind] = {tall, sound, heavy, w, h, d, r, cy}   // w,h,d は実測の外寸
```

| kind | 物 | 外寸の目安 (幅×高さ×奥行) | sound |
|---|---|---|---|
| milk | 牛乳パック 1L（屋根型・白と青） | 0.07×0.235×0.07 tall | slosh |
| juice | オレンジジュースのびん／ボトル | 0.075×0.22×0.075 tall | slosh |
| yogurt | ヨーグルトの大きいカップ（白・青いふた） | 0.095×0.085×0.095 | tok |
| pudding | プリン（透明カップ・黄色とカラメル・金色のふた） | 0.085×0.07×0.085 | tok |
| egg | たまご6こパック | 0.155×0.07×0.105 | rattle |
| cheese | 穴あきチーズのくさび形 | 0.12×0.06×0.09 | thud |
| strawberry | いちごパック（透明の入れ物） | 0.15×0.065×0.11 | crinkle |
| tomato | トマト | 0.075×0.06×0.075 | thud |
| apple | りんご | 0.085×0.08×0.085 | thud |
| carrot | にんじん3本の束（葉つき・横置き） | 0.20×0.045×0.09 | thud |
| cabbage | キャベツ | 0.17×0.15×0.17 | thud |
| watermelon | すいかのくし形切り（皮を下、赤い面が上・前） | 0.20×0.11×0.10 | thud |

## 音（`Sound`）— 02-audio.js

```
Sound.unlock()                       // 最初の pointerdown の中で呼ぶ。何度呼んでもよく、失敗しても例外を出さない
Sound.play(name, {vol:1, pitch:0, delay:0})   // pitch は半音。未解除・失敗時は何もしない
Sound.loop(name, on, {vol:1})        // 'fridgeHum' | 'cartRoll'
Sound.ambience(name)                 // 'home' | 'store' | null（ゆっくり切り替え）
Sound.pause() / Sound.resume()       // 画面が隠れた／戻った
```

`play` の名前: `tap lift drop back slide slosh rattle tok crinkle thud beep beepFinger bagRustle pay print tear cart squeak doorOpen doorClose growl lonely place magnet happy hint chime keys whoosh ending`

## 手（`Hand`）— 04-hand.js

```
Hand.create({ghost:false, sleeve:true, side:'R'}) -> {
  group,          // 原点=手首。指は +Y へ伸び、手の甲が +Z（見る側）を向く。sleeve:true なら袖つきの前腕が -Y へ 0.55m 伸びる
  tip,            // 人さし指の先に付いた Object3D
  pose(name, dur) // 'open' | 'point' | 'grip' | 'pinch' | 'card'（カードを持つ）
  update(dt),     // 指のアニメーションを進める
  setOpacity(a),
  hold            // 物を持つ位置の Object3D（向きは人さし指に沿う）
}
```
`ghost:true` は半透明のお手本用（袖なし・全体が1つの淡い半透明素材）。

## 小道具（`Props`）— 08-props.js

```
Props.basket() -> Group   // 灰色の買い物かご。原点=底の中心。上の外寸 0.50×0.36、高さ 0.24
   userData = { floorY, rimY, slots:[{x,z}×6] }   // slots はかご床の上の置き場所（ローカル座標、3列×2行）
Props.bag() -> Group      // 生成りのエコバッグ（赤いりんごの模様）。原点=底の中心。0.36×0.38×0.16、口が開いて立つ
   userData = { mouthY, innerW, innerD }
```

## 中心エンジン（`G`）— 06-core.js

```
G.renderer, G.env(映り込み用テクスチャ), G.low(低負荷モード), G.time(秒)
G.view = {w, h, aspect, portrait}
G.state / G.save() / G.resetState()

G.addScene(name, def)     // def は下記
G.go(name)                // 暗転して切り替え。切り替え中は入力を渡さない
G.current                 // 今の場面名

G.fit(camera, {center:Vector3, w, h, pitch:0, yaw:0, fov:35})
    // center を中心とする幅 w × 高さ h の四角（視線に垂直）が、縦でも横でも画面の安全域に全部入る位置へカメラを置く。pitch>0 は見下ろし。距離を返す
G.pick(p, list, marginPx=24) -> Object3D | null
    // 画面上の距離で選ぶ大きな当たり判定。list の各物の中心と半径（userData.r、無ければ自動計測）を画面に投影し、指に一番近い物を返す
G.onPlane(p, plane, out) -> Vector3 | null   // 指の光線と THREE.Plane の交点
G.screen(vec3) -> {x, y}                    // ワールド → 画面 px

G.tween(dur, fn(k), {ease, delay, done}) -> {stop()}   // k は 0→1（ease 済み）。場面を出ると自動で止まる
G.after(sec, fn) -> {stop()}                           // ゲーム内時間の遅延。場面を出ると自動で消える
G.ease = {linear, out, inOut, back, bounce, elastic}

G.glow(obj, {color:0xfff0c0, size:1.5}) -> {level(v), remove()}  // 物のまわりの柔らかい光（加算）。obj に追従
G.puff(pos, {n:8, color:0xffffff, size:0.03, up:0.1, spread:0.05, life:0.8})   // 小さな粒（冷気・きらめき）。総数に上限あり
G.shake(obj, amp=0.05, dur=0.4)                                  // ぷるっと揺らす（終わると元の姿勢に戻る）
G.icon(kind) -> HTMLCanvasElement   // 品物の絵（256×256、背景透明）。レジ画面・レシート用。キャッシュされる

G.hint({key, target, to, wiggle})   // 「次の1操作」を知らせる。null で消す
```

### 場面の定義

```
G.addScene('shelf', {
  build: function(){ this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(...); ... },  // 最初の1回だけ
  enter: function(from){ ... },   // 入るたび。G.state を見て状態を復元する
  exit:  function(){ ... },
  layout: function(){ G.fit(this.camera, {...}); },   // 入った時と、画面の大きさ・向きが変わるたび
  update: function(dt){ ... },    // dt 秒（最大 0.05）
  down: function(p){}, move: function(p){}, up: function(p){}   // 最初の指だけ届く
});
```
`p = {x, y, ndc:Vector2, dx, dy, dist, t, cancel}`（x,y は CSS px、dx/dy は押した所から、dist は動いた最大距離 px、t は押してからの秒）。
場面は `this.scene.environment = G.env; this.scene.environmentIntensity = 0.9` とし、影を落とす `DirectionalLight` は1つ（`G.low` なら影の解像度 512、通常 1024）。

### 手がかり（必須）

どの瞬間も「次にさわる物」を `G.hint` で登録する（演出中は `G.hint(null)`）。
```
G.hint({ key:'pick', target: obj または function(){return Vector3}, to: obj または function または null, wiggle: function(){...} })
```
- すぐ: target が柔らかく脈打って光る（core がやる）。指で持っている間は `to` が光る。
- 4秒さわらない: 光が強まり、`wiggle()` が約3秒ごとに呼ばれる（物を揺らす・ママが指さす等）＋小さな音。
- 9秒さわらない: 半透明の手のお手本（target を押して `to` まで運ぶ／`to` が無ければその場でとんと押す）が繰り返される。
- 指が触れたら最初の段階へ戻る。同じ key・同じ target で呼び直してもタイマーは戻らない。

### 保存する状態

```
G.state = {
  v: 1,
  scene: 'home1' | 'shelf' | 'register' | 'home2',   // 再開する場面
  trip: 0,            // 終えた買い物の回数
  basket: [kind…],    // かごの中（shelf で入れた順）
  scanned: [kind…],   // ぴっ済みでバッグに入った物（register）
  bag: [kind…],       // バッグにまだある物（home2）
  fridge: [{k:kind, s:slotId}…],   // 冷蔵庫に置いた物
  receipt: [kind…],   // 扉に貼るレシートの中身
  done: false         // home2 で扉を閉めて終わりの絵になったか
}
```
状態を変えたら `G.save()`。場面は `enter` でこの状態から見た目を作り直す（途中で閉じても、その場面の頭から同じ中身で再開できる）。

## 標準の光（見た目をそろえる）

`renderer.toneMapping = ACESFilmicToneMapping`、露出 0.78（白い物が飛ばないよう統合時に下げた）、sRGB 出力。`scene.environment = G.env`（RoomEnvironment 由来、強さ 0.9）。主光は暖かい白の DirectionalLight 強さ 2.2 前後＋ HemisphereLight 0.4。`tools/preview.cjs` はこの光で部品を写す。

## 統合時に決めたこと

- `Items.make` は、同じ素材の部品を1つの形にまとめた複製を返す（`Items._bake`。1品 2〜6 メッシュ）。品物の中の部品を個別に動かすことはできない。
- 光るヒント（`G.glow`）は黄色寄りの通常合成（白い床や冷蔵庫の上でも見える）。大きさは半径 0.2m まで。
- レジ: 持った品物の高さは「指が台のどこを指しているか」だけで決める（品物の位置で決めると揺れ戻して何度も鳴る）。全部読み終えると、空のかごが手前へ下がってからレシートが出る。
- ビルドは `node build.cjs`。`tools/preview.cjs` は部品の見た目確認用。
- 起動を軽くするため、`30-shelf.js` `40-register.js` は後から動く（`build.cjs` の `LATER`）。この2つの中身を、ほかのファイルが読み込み直後に当てにしないこと。
- `G.prep(fn)` は遊んでいる間に裏で1つずつ進める仕事（Promise を返すと終わるまで次を待つ）。`G.prepScene(name, extras)` は場面を前もって組み立て、計算式と画像を用意する（組み立ては1回だけ。場面の `build` は「今の場面でない時に呼ばれても困らない」ように書く）。
- `THREE` は使う部品だけの版（`tools/three.entry.js`）。新しい `THREE.○○` を使う時はそこに足して作り直す。
