# 動画書き出し機能 実装プラン（mp4 + GIF）

LINE風チャットスライドジェネレーターに「会話を動画として書き出す」機能を追加する。
DEV「GitHub Finish-Up-A-Thon」応募の Comeback Story として、既存の pptx 生成（公開済み技術記事で解説）に対する「やり残し＝動画化」を完成させる位置づけ。

進め方: 実装の主役は VS Code + GitHub Copilot。本ファイルは設計の入力（Copilotに参照させる）。

---

## 1. ゴール（Before / After）

- Before: 会話を入力 → アニメ付き `.pptx` をダウンロード。保存できるのは静止スライドのみ（ブラウザのプレビュー再生は保存不可）。
- After: 同じ会話から、吹き出しが1つずつ出る縦型(9:16)の **mp4 / GIF** を書き出せる。SNS（X / Instagram / TikTok）や Slack / LINE にそのまま貼れる。

## 2. 技術方針（確定）

- 方式: **ブラウザ完結**（サーバ・Vercel構成は変更しない。`api/generate.py` は触らない）。
- 描画: **canvas に描き直す**（html2canvas は使わない。折返しは `ctx.measureText` で正確に出せる）。
- 録画→変換ルート（推奨）:
  1. canvas でアニメ再生 → `canvas.captureStream(fps)` → `MediaRecorder` で **webm** を録画
  2. **`ffmpeg.wasm`** で webm → **mp4**（H.264 / yuv420p / faststart）と **GIF**（palette 2パス）に変換
- ffmpeg コアは **シングルスレッド版 `@ffmpeg/core`** を使う。
  - `SharedArrayBuffer` 不要 → COOP/COEP ヘッダ設定が不要でデプロイが単純。
  - 遅い場合のみ `@ffmpeg/core-mt` ＋ COOP/COEP（後述）へ移行を検討。
- フォールバック（録画でフレーム落ちが出る場合）: canvas を各フレームでオフライン描画 → 画像列を ffmpeg に渡してエンコード（メモリは増えるがタイミングが正確）。

### パラメータ初期値

- 出力解像度: 720 × 1280（9:16）。canvas は2倍(1440×2560)で描いて縮小すると綺麗。
- fps: mp4 = 30、GIF = 15（GIFはサイズ抑制のため間引く）。
- 出現タイミング: 既存 `stagger_ms`（既定800ms）に同期。出現アニメ自体は約450ms。
- 末尾に静止 1.5秒（最後の状態を見せる）。

## 3. 作業分解（Copilotに投げる単位 / チェックリスト）

- [ ] Phase 1 canvasレンダラ: 配色・寸法を定数化し、phone / screen / header / Dynamic Island / statusbar / 吹き出し / 入力バー を描く関数群。CSS（`index.html` の `:root` と各クラス）と python版（`api/generate.py` の C_* 定数）を見比べて色を合わせる。
- [ ] Phase 2 レイアウト: 折返し計算（`ctx.measureText`）と bottom / top / center 配置を canvas で再現。全吹き出しの高さ合計から開始Yを決める（python版 `build_pptx` の anchor ロジックを移植）。
- [ ] Phase 3 アニメーション: `requestAnimationFrame` で各フレーム描画。吹き出しは opacity フェード＋下から数px上昇で出現。出現順・間隔は既存 `play()`（`index.html` の `stagger`）に合わせる。
- [ ] Phase 4 録画: `canvas.captureStream(fps)` → `MediaRecorder`（`video/webm`）→ Blob。録画の開始/停止をアニメ尺＋末尾静止に同期。
- [ ] Phase 5 変換: `@ffmpeg/ffmpeg`(0.12系) + `@ffmpeg/core`(ST) を読み込み。
      - mp4: `-c:v libx264 -pix_fmt yuv420p -movflags +faststart`
      - GIF: 2パス palette（`palettegen` → `paletteuse`、`fps=15,scale=480:-1:flags=lanczos`）
- [ ] Phase 6 演出（少し）: 「入力中…」ドット3つ → 相手バブル出現。（任意）既読表示・タイムスタンプ。動画でこそ映える。
- [ ] Phase 7 UI: 「動画を書き出し」ボタン、フォーマット選択（webm / mp4 / GIF）、解像度（等倍/2倍）、進捗表示（ffmpegの `progress` を表示）。

## 4. 既存コードとの統合点（流用するもの）

- `parse()`（会話パース, `index.html`）: 入力テキスト → スライド配列。そのまま流用。
- `stagger` 値・`anchor`（bottom/top/center）・相手名/ステータス: 既存の入力UIを流用。
- 配色: `index.html` の `:root`（`--green:#06C755` 等）と `api/generate.py` の `C_*`。
- 追加要素: `index.html` に `<canvas>` 1枚と書き出しUIを足すだけ。サーバ・`vercel.json` は原則変更なし。

## 5. 難所と対策

- 絵文字・日本語フォント: `ctx.fillText` で概ね描けるが OS 環境差あり。フォント指定は CSS と同じ "Hiragino Sans" 系を先頭に。
- ffmpeg.wasm 初回ロード: コア(wasm)が重い。読み込み中はスピナー＋「初回のみ時間がかかります」表示。
- ST コアのエンコード時間: 長尺だと遅い。動画長の目安を UI に出す（例: 会話が長いと時間がかかる）。
- MediaRecorder の webm は可変フレームレートになりがち: ffmpeg 側で `-r 30` を明示してならす。
- もし将来 MT コアにする場合のみ `vercel.json` にヘッダ追加が必要:
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```
  （現行の version2 / builds 構成との併用は要検証。ST コアなら不要。）
- 出力は無音。
- 主対象は PC 版 Chrome（`MediaRecorder` / `captureStream` のブラウザ差のため）。

## 6. Copilot プロンプト例（進め方A）

各 Phase を関数コメントで先に書き、Copilot に補完させる。

```js
// LINE風の電話フレームをcanvasに描画する。
// 引数: ctx, x, y, w, h。CSSの .phone と同じ黒の角丸＋影、内側に画面(.screen)。
function drawPhoneFrame(ctx, x, y, w, h) { /* Copilotに補完させる */ }

// 吹き出しを描画。side("L"|"R")、text、左上座標、最大幅から
// 折返し(ctx.measureText)して角丸矩形＋テキストを描く。Lは左+アバター、Rは右。
function drawBubble(ctx, side, text, x, y, maxW) { /* 〃 */ }
```

詰まったら Copilot Chat（github.com/copilot）に「このcanvasで吹き出しの折返しが想定とずれる」等を相談。
**役立った場面は都度メモ**（応募記事「My Experience with GitHub Copilot」の素材）。

## 7. 受け入れ基準（完成の定義）

- サンプル会話で mp4 と GIF が書き出せる。
- 吹き出しが `stagger` 通りに順次出現し、9:16 で表示される。
- 日本語・絵文字が文字化けしない。
- PC 版 Chrome で生成・再生を確認。

## 8. 応募記事用に撮る素材

- Before: 公開済み技術記事へのリンク＋ pptx のスクショ。
- After: 生成した mp4 / GIF、書き出しUIのスクショ。
- Copilot 貢献メモ: canvas折返し、ffmpeg コマンド、入力中アニメ 等の具体場面。
